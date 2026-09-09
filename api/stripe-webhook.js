import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function rawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function tierForPlan(active, plan, explicitTier) {
  if (!active) return "free";
  const requested = String(explicitTier || "").toLowerCase();
  const p = String(plan || "").toLowerCase();
  if (requested === "pro" || p === "pro" || p.startsWith("pro") || p.startsWith("vip")) return "pro";
  return "premium";
}

const INTERNAL_ENTITLEMENTS = new Set(["founder", "admin", "internal"]);

async function setPremium(uid, active, until, plan, explicitTier) {
  if (!uid) return;

  const { data: existing, error: readError } = await admin
    .from("profiles")
    .select("entitlement_source")
    .eq("id", uid)
    .maybeSingle();

  if (readError) throw readError;

  const source = String(existing?.entitlement_source || "").toLowerCase();
  if (INTERNAL_ENTITLEMENTS.has(source)) return;

  const tier = tierForPlan(active, plan, explicitTier);
  const { error } = await admin.from("profiles").update({
    is_premium: active,
    premium_until: until ? new Date(until * 1000).toISOString() : null,
    tier,
    entitlement_source: active ? "stripe" : null,
  }).eq("id", uid);

  if (error) throw error;
  if (!active) await admin.rpc("strip_lapsed_premium");
}

function periodEnd(sub) {
  return sub?.current_period_end ?? sub?.items?.data?.[0]?.current_period_end ?? null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  let event;
  try {
    const body = await rawBody(req);
    event = stripe.webhooks.constructEvent(body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("bad webhook signature:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object;
        const sub = await stripe.subscriptions.retrieve(s.subscription);
        await setPremium(s.client_reference_id, true, periodEnd(sub), sub.metadata?.plan, sub.metadata?.tier);
        break;
      }
      case "customer.subscription.updated": {
        const sub = event.data.object;
        const live = ["active", "trialing"].includes(sub.status);
        await setPremium(sub.metadata?.supabase_uid, live, periodEnd(sub), sub.metadata?.plan, sub.metadata?.tier);
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        await setPremium(sub.metadata?.supabase_uid, false, null);
        break;
      }
      case "invoice.payment_failed":
      default:
        break;
    }
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("webhook handler error:", err);
    return res.status(500).json({ error: "handler failed" });
  }
}
