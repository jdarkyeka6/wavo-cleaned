import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const PLANS = {
  standard: { label: "Wavo Premium", amount: 499, tier: "premium" },
  student: { label: "Wavo Premium — Student", amount: 349, tier: "premium" },
  plus: { label: "Wavo Plus", amount: 999, tier: "plus", priceId: "price_1UESMPLytdJimLtBn6gVW7Qy" },
  pro: { label: "Wavo Pro", amount: 1499, tier: "pro" },
};

const TIER_RANK = { free: 0, premium: 1, plus: 2, pro: 3, vip: 3 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
    if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: "Server missing STRIPE_SECRET_KEY" });
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server missing Supabase service credentials" });

    const stripe = new Stripe(STRIPE_SECRET_KEY);
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    if (!token) return res.status(401).json({ error: "Not signed in" });

    const asUser = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: authErr } = await asUser.auth.getUser(token);
    const user = userData?.user;
    if (authErr || !user) return res.status(401).json({ error: "Session expired — sign in again" });

    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    const requested = String(body?.plan || "standard");
    const plan = PLANS[requested] ? requested : "standard";
    const selected = PLANS[plan];

    const { data: profile, error: profErr } = await admin
      .from("profiles")
      .select("id,username,is_premium,premium_until,stripe_customer_id,banned,tier,entitlement_source")
      .eq("id", user.id)
      .single();
    if (profErr) return res.status(500).json({ error: "Profile lookup failed: " + profErr.message });
    if (!profile) return res.status(404).json({ error: "No profile found" });
    if (profile.banned) return res.status(403).json({ error: "Your account can't buy a paid plan right now." });

    const stillActive = profile.is_premium && (!profile.premium_until || new Date(profile.premium_until) > new Date());
    const rawTier = String(profile.tier || "free").toLowerCase();
    const currentTier = stillActive && String(profile.entitlement_source || "").toLowerCase() === "stripe_plus" ? "plus" : rawTier;
    if (stillActive && (TIER_RANK[currentTier] ?? 0) >= (TIER_RANK[selected.tier] ?? 0)) {
      const label = currentTier === "pro" || currentTier === "vip" ? "Wavo Pro" : currentTier === "plus" ? "Wavo Plus" : "Wavo Premium";
      return res.status(400).json({ error: `You're already on ${label}.` });
    }

    let customerId = profile.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_uid: user.id, username: profile.username || "" },
      });
      customerId = customer.id;
      await admin.from("profiles").update({ stripe_customer_id: customerId }).eq("id", user.id);
    }

    const origin = req.headers.origin || (req.headers.host ? `https://${req.headers.host}` : "https://www.wavo.lol");
    const lineItem = selected.priceId
      ? { quantity: 1, price: selected.priceId }
      : {
          quantity: 1,
          price_data: {
            currency: "aud",
            unit_amount: selected.amount,
            recurring: { interval: "month" },
            product_data: { name: selected.label },
          },
        };

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [lineItem],
      success_url: `${origin}/?premium=1&tier=${selected.tier}`,
      cancel_url: `${origin}/?premium=0`,
      client_reference_id: user.id,
      subscription_data: { metadata: { supabase_uid: user.id, plan, tier: selected.tier } },
      allow_promotion_codes: true,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("checkout error:", err);
    return res.status(500).json({ error: err?.message || "Unknown checkout error" });
  }
}
