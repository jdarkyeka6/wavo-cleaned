import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

function periodEnd(subscription) {
  return subscription?.current_period_end ?? subscription?.items?.data?.[0]?.current_period_end ?? null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
    if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: "Server missing STRIPE_SECRET_KEY" });
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: "Server missing Supabase service credentials" });
    }

    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    if (!token) return res.status(401).json({ error: "Not signed in" });

    const stripe = new Stripe(STRIPE_SECRET_KEY);
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    const asUser = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: userData, error: authError } = await asUser.auth.getUser(token);
    const user = userData?.user;
    if (authError || !user) return res.status(401).json({ error: "Session expired — sign in again" });

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id,stripe_customer_id")
      .eq("id", user.id)
      .single();

    if (profileError) return res.status(500).json({ error: "Profile lookup failed: " + profileError.message });
    if (!profile?.stripe_customer_id) {
      return res.status(404).json({ error: "No Stripe subscription is linked to this Wavo account." });
    }

    const subscriptions = await stripe.subscriptions.list({
      customer: profile.stripe_customer_id,
      status: "all",
      limit: 100,
    });

    const active = subscriptions.data.filter((subscription) => ACTIVE_STATUSES.has(subscription.status));
    if (!active.length) {
      return res.status(404).json({ error: "No active Wavo subscription was found." });
    }

    const needsCancellation = active.filter((subscription) => !subscription.cancel_at_period_end);
    const updated = await Promise.all(
      needsCancellation.map((subscription) =>
        stripe.subscriptions.update(subscription.id, { cancel_at_period_end: true }),
      ),
    );

    const effective = [
      ...updated,
      ...active.filter((subscription) => subscription.cancel_at_period_end),
    ];
    const latestEnd = effective
      .map(periodEnd)
      .filter(Boolean)
      .reduce((latest, value) => Math.max(latest, value), 0);

    return res.status(200).json({
      ok: true,
      alreadyScheduled: needsCancellation.length === 0,
      subscriptionsScheduled: effective.length,
      currentPeriodEnd: latestEnd ? new Date(latestEnd * 1000).toISOString() : null,
    });
  } catch (error) {
    console.error("cancel subscription error:", error);
    return res.status(500).json({ error: error?.message || "Could not cancel subscription." });
  }
}
