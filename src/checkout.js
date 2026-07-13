import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/checkout
 *
 * Creates a Stripe Checkout session for Wavo Premium.
 *
 * The client never tells us the price. It sends nothing but its auth token.
 * The price comes from STRIPE_PRICE_ID on the server, and the user comes from
 * verifying the token — because "trust the amount the browser sent" is exactly
 * the Stripe price-manipulation bug, and we're not doing that one twice.
 */

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Service role: needed to read/write profiles regardless of RLS.
// This key must NEVER be exposed to the browser. No VITE_ prefix.
const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

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

    // 2. Banned users don't get to buy a badge.
    const { data: profile } = await admin
      .from("profiles")
      .select("id, username, is_premium, premium_until, stripe_customer_id")
      .eq("id", user.id)
      .single();

    if (!profile) return res.status(404).json({ error: "No profile" });

    const stillActive =
      profile.is_premium &&
      (!profile.premium_until || new Date(profile.premium_until) > new Date());
    if (stillActive) {
      return res.status(400).json({ error: "You're already a Supporter." });
    }

    // 3. Reuse the Stripe customer if we've seen them before, so one person
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
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${origin}/?premium=1`,
      cancel_url: `${origin}/?premium=0`,
      // The webhook reads this to know who paid. Never trust the browser for it.
      client_reference_id: user.id,
      subscription_data: { metadata: { supabase_uid: user.id } },
      allow_promotion_codes: true,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("checkout error:", err);
    return res.status(500).json({ error: "Couldn't start checkout." });
  }
}
