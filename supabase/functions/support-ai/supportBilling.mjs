// Billing guidance is deliberately conservative:
// native StoreKit prices come from Apple; Wavo web currently has conflicting
// fallback prices for Pro in multiple components, so no Pro price is quoted.
// This module must NOT be used to perform purchases or manage entitlements.

const WEB_ORIGINS = new Set(["https://wavo.lol", "https://www.wavo.lol"]);

export function resolveSupportPlatform(reported, origin) {
  if (reported === "ios") return "ios";
  if (reported === "android") return "android";
  // A client-provided "web" flag alone is not proof of a website session.
  if (reported === "web" && WEB_ORIGINS.has(origin)) return "web";
  return "unknown";
}

export function billingGuidance(platform) {
  const basic = [
    "Never claim you have checked this user's purchases, billing status, entitlement or Apple/Stripe storefront.",
    "Do not promise refunds or cancellation actions.",
    "Apple iOS prices are loaded dynamically from App Store products and may differ by storefront. Never invent or quote a fixed Apple price.",
    "Pro's displayed website fallback price is inconsistent between Wavo components; do not quote an exact Pro website price until reconciled.",
    "Only a final checkout screen is authoritative about the actual price charged.",
  ].join("\n- ");
  if (platform === "web") {
    return `WEB SESSION VERIFIED FROM ORIGIN. Website UI currently displays Premium A$4.99/month and Plus A$9.99/month as defaults, not guaranteed final checkout prices. Pro amount is unverified. You may describe in-app Apple subscriptions neutrally without quoting Apple amounts. Do not compare or steer between purchase routes.\n- ${basic}`;
  }
  if (platform === "ios") {
    return `IOS APP SESSION (reported by client). Explain that Wavo iOS subscriptions use Apple In-App Purchase, and users should check the exact price in the App Store purchase sheet before confirming. Never mention or link to external checkout, web plan prices, or alternative purchase methods.\n- ${basic}`;
  }
  return `ANDROID/UNKNOWN PLATFORM. Do not invent Android subscription options or quote website/Apple prices. Ask which platform the user is using when purchase instructions depend on it. Never suggest alternative purchase routes.\n- ${basic}`;
}
