import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/stripe-webhook
 *
 * This is the ONLY thing in the whole system allowed to set is_premium.
 * The database has a trigger (protect_premium_columns) that reverts any
 * attempt to change is_premium unless the caller is the service role — so
 * even if someone found a hole in the app, they couldn't grant themselves
 * premium. The money has to actually arrive first.
 *
 * Stripe sends the raw body signed; Vercel would normally parse it into JSON
 * and break the signature, hence bodyParser: false below.
 */

export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

function rawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function setPremium(uid, active, until) {
  if (!uid) return;
  await admin
    .from("profiles")
    .update({
      is_premium: active,
      premium_until: until ? new Date(until * 1000).toISOString() : null,
    })
    .eq("id", uid);

  // If they've lapsed, take the Supporter badge and the coloured name off
  // them — otherwise one month buys the status forever.
  if (!active) await admin.rpc("strip_lapsed_premium");
}

// Stripe moved current_period_end onto the subscription ITEM in newer API
// versions; older ones kept it on the subscription. Check both so the
// expiry date never silently comes back undefined (which stored null and
// made premium permanent).
function periodEnd(sub) {
  return (
    sub?.current_period_end ??
    sub?.items?.data?.[0]?.current_period_end ??
    null
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  let event;
  try {
    const body = await rawBody(req);
    event = stripe.webhooks.constructEvent(
      body,
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    // A bad signature means it isn't Stripe. Anyone can POST to this URL.
    console.error("bad webhook signature:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object;
        const uid = s.client_reference_id;
        const sub = await stripe.subscriptions.retrieve(s.subscription);
        await setPremium(uid, true, periodEnd(sub));
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object;
        const uid = sub.metadata?.supabase_uid;
        const live = ["active", "trialing"].includes(sub.status);
        await setPremium(uid, live, periodEnd(sub));
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        await setPremium(sub.metadata?.supabase_uid, false, null);
        break;
      }

      case "invoice.payment_failed": {
        // Don't strip them instantly on a single failed payment — Stripe
        // retries, and a kid's card bouncing once isn't a reason to
        // publicly demote them mid-conversation. Stripe will send
        // subscription.deleted if it truly gives up.
        break;
      }

      default:
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("webhook handler error:", err);
    return res.status(500).json({ error: "handler failed" });
  }
}
