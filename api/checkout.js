import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/checkout — create a Stripe Checkout session for Wavo Premium.
 *
 * Plans are chosen by keyword; the browser never names a price.
 *   standard  $4.99 AUD/mo   student  $3.49 AUD/mo
 *
 * Everything that can throw lives INSIDE the handler's try/catch, and every
 * failure returns JSON with a real message. That's deliberate: if a key is
 * missing or Stripe rejects something, we want to read the reason, not
 * Vercel's generic "A server error has occurred" (which isn't even JSON and
 * crashes the frontend's res.json()).
 */

const PLANS = {
  standard: { label: "Wavo Premium", amount: 499 },
  student: { label: "Wavo Premium — Student", amount: 349 },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  try {
    // --- env sanity: fail loud and readable, not as a raw crash ---
    const {
      STRIPE_SECRET_KEY,
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
    } = process.env;
    if (!STRIPE_SECRET_KEY)
      return res.status(500).json({ error: "Server missing STRIPE_SECRET_KEY" });
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)
      return res
        .status(500)
        .json({ error: "Server missing Supabase service credentials" });

    const stripe = new Stripe(STRIPE_SECRET_KEY);
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // --- who is this? ---
    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    if (!token) return res.status(401).json({ error: "Not signed in" });

    // Validate the login token by asking Supabase to resolve it. We pass the
    // token as the client's auth header (rather than admin.auth.getUser,
    // which doesn't validate reliably under the newer sb_secret_ key format).
    const asUser = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: authErr } = await asUser.auth.getUser(token);
    const user = userData?.user;
    if (authErr || !user)
      return res
        .status(401)
        .json({ error: "Session expired — sign in again" + (authErr ? ` (${authErr.message})` : "") });

    // --- body may arrive parsed or as a raw string; handle both ---
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }
    const requested = String(body?.plan || "standard");
    const plan = PLANS[requested] ? requested : "standard";
    const { label, amount } = PLANS[plan];

    // --- profile checks ---
    const { data: profile, error: profErr } = await admin
      .from("profiles")
      .select("id, username, is_premium, premium_until, stripe_customer_id, banned")
      .eq("id", user.id)
      .single();

    if (profErr)
      return res
        .status(500)
        .json({ error: "Profile lookup failed: " + profErr.message });
    if (!profile) return res.status(404).json({ error: "No profile found" });
    if (profile.banned)
      return res
        .status(403)
        .json({ error: "Your account can't buy Premium right now." });

    const stillActive =
      profile.is_premium &&
      (!profile.premium_until || new Date(profile.premium_until) > new Date());
    if (stillActive)
      return res.status(400).json({ error: "You're already a Supporter." });

    // --- reuse or create the Stripe customer ---
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
      (req.headers.host ? `https://${req.headers.host}` : "https://www.wavo.lol");

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
      client_reference_id: user.id,
      subscription_data: { metadata: { supabase_uid: user.id, plan } },
      allow_promotion_codes: true,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    // The whole point: surface the ACTUAL reason as JSON.
    console.error("checkout error:", err);
    return res
      .status(500)
      .json({ error: err?.message || "Unknown checkout error" });
  }
}
