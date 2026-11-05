// Server-side only. Never import this module from the browser bundle.
// This private-table gate fails closed to prevent duplicate Stripe customers
// when billing identity storage is unavailable.
const TABLE = "wavo_billing_customer_links";

function assertIdentity(userId) {
  if (typeof userId !== "string" || userId.length < 10) {
    throw new Error("Billing user identity is missing");
  }
}

export async function saveStripeCustomerId(admin, userId, stripeCustomerId) {
  assertIdentity(userId);
  if (typeof stripeCustomerId !== "string" || !stripeCustomerId.startsWith("cus_")) {
    throw new Error("Invalid Stripe customer reference");
  }
  const { error } = await admin.from(TABLE).upsert({
    user_id: userId,
    stripe_customer_id: stripeCustomerId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (error) {
    // Never silently fall back to a public profiles column.
    console.error("Private Stripe customer write failed", error.code);
    throw new Error("Could not securely save billing account");
  }
  return stripeCustomerId;
}

export async function getStripeCustomerId(admin, userId, legacyCustomerId = null) {
  assertIdentity(userId);
  const { data, error } = await admin
    .from(TABLE)
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("Private Stripe customer lookup failed", error.code);
    throw new Error("Billing account lookup is temporarily unavailable");
  }
  if (data?.stripe_customer_id) return data.stripe_customer_id;
  // One-way migration of old accounts; never re-expose in profiles.
  if (legacyCustomerId) return saveStripeCustomerId(admin, userId, legacyCustomerId);
  return null;
}
