import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/checkout
 *
 * Creates a Stripe Checkout session for Wavo Premium.
 *
 * The client never tells us a price. It sends a PLAN KEYWORD:
 *   "standard"   $4.99 AUD / month
 *   "student"    $3.49 AUD / month  (honour system)
 *
 * The server looks the keyword up in its own table below. The worst a
 * tampered client can do is pick a plan we already publish — it can never
 * invent a price. That's the difference between pointing at a menu and
 * writing your own number on the bill.
 *
 * Prices live HERE, in code, as `price_data`. Stripe creates the price
 * object on the fly, so there are no STRIPE_PRICE_ID env vars to keep in
 * sync and nothing to click in the Stripe dashboard. To change a price,
 * change the number below and redeploy.
 */

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Service role: needed to read/write profiles regardless of RLS.
// This key must NEVER be exposed to the browser. No VITE_ prefix.
const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// The allowlist. If it isn't in here, it isn't for sale.
// Amounts are in cents: 499 = $4.99 AUD.
const PLANS = {
  standard: { label: "Wavo Premium", amount: 499 },
  student: { label: "Wavo Premium — Student", amount: 349 },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  try {
    // 1. Who is this, really?
    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    if (!token) return res.status(401).json({ error: "Not signed in" });

    const { data: userData, error: authErr } = await admin.auth.getUser(token);
    const user = userData?.user;
    if (authErr || !user) return res.status(401).json({ error: "Not signed in" });

    // 2. Which plan? Unknown keyword falls back to standard monthly.
    //    Note this is a lookup, not a price. The browser cannot name a number.
    const requested = String(req.body?.plan || "standard");
    const plan = Object.prototype.hasOwnProperty.call(PLANS, requested)
      ? requested
      : "standard";
    const { label, amount } = PLANS[plan];

    // 3. Banned users don't get to buy a badge. (For real, this time.)
    const { data: profile } = await admin
      .from("profiles")
      .select("id, username, is_premium, premium_until, stripe_customer_id, banned")
      .eq("id", user.id)
      .single();

    if (!profile) return res.status(404).json({ error: "No profile" });

    if (profile.banned) {
      return res
        .status(403)
        .json({ error: "Your account can't buy Premium right now." });
    }

    const stillActive =
      profile.is_premium &&
      (!profile.premium_until || new Date(profile.premium_until) > new Date());
    if (stillActive) {
      return res.status(400).json({ error: "You're already a Supporter." });
    }

    // 4. Reuse the Stripe customer if we've seen them before, so one person
    //    doesn't accumulate a new customer record every time they click.
    let customerId = profile.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_uid: user.id, username: profile.username || "" },
      });
      customerId = customer.id;
      await admin
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.id);
    }

    const origin =
      req.headers.origin ||
      `https://${req.headers.host}` ||
      "https://www.wavo.lol";

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "aud",
            unit_amount: amount,
            recurring: { interval: "month" },
            product_data: { name: label },
          },
        },
      ],
      success_url: `${origin}/?premium=1`,
      cancel_url: `${origin}/?premium=0`,
      // The webhook reads this to know who paid. Never trust the browser for it.
      client_reference_id: user.id,
      subscription_data: { metadata: { supabase_uid: user.id, plan } },
      allow_promotion_codes: true,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("checkout error:", err);
    return res.status(500).json({ error: "Couldn't start checkout." });
  }
}
