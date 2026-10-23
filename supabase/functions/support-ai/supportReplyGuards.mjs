// Last-line guardrails for AI-generated support text.
// Does not replace prompting, authorization, or App Store compliance reviews.
export function guardSupportReply(reply, platform, question) {
  const text=String(reply || "").trim();
  if(!text) return text;
  const q=String(question||"").toLowerCase();
  const isPurchaseRelated=/\b(premium|pro|plus|subscription|subscribe|billing|price|purchase|payment|refund|charged|checkout|cost)\b/.test(q);
  // Support has no account-action tools. Do not falsely confirm actions
  // such as changing settings, refunding, cancelling, or fixing accounts.
  if(/\b(?:i have|i've|we have|we've)\s+(?:now\s+)?(?:refunded|cancelled|canceled|unlocked|deleted|fixed|reset|changed)\b/i.test(text)) {
    return "I can explain the steps, but I can't make changes to your Wavo account, issue refunds, or confirm a fix myself. For help from a person, contact contact@builtbyjake.site.";
  }
  if(!isPurchaseRelated) return text;

  const hasPrice=/\b(?:a\$|aud\s*\$?|\$)\s*\d+(?:\.\d{1,2})?\b/i.test(text);
  const steersToExternalCheckout=/\bwavo\.lol\/subscriptions\b|\b(?:buy|subscribe|pay|checkout)\s+(?:on|through|via|at)\s+(?:the\s+)?(?:website|web|stripe)\b/i.test(text);
  if(platform==="ios" && (hasPrice || steersToExternalCheckout)) {
    return "For Wavo subscriptions in the iOS app, check the current price on the Apple App Store purchase sheet before confirming. I can't verify a fixed Apple price or your billing details from here.";
  }
  if(platform==="web" && /\bpro\b/i.test(q) && /\b(?:a\$|aud\s*\$?|\$)\s*\d+(?:\.\d{1,2})?\b/i.test(text)) {
    return "I can't confirm the exact Wavo Pro website price from here because the app's displayed price information is inconsistent. Please check the final amount at checkout before purchasing.";
  }
  if(platform==="unknown" || platform==="android") {
    if(hasPrice || steersToExternalCheckout) {
      return "I can't verify a subscription price or purchase route for your platform. Which device are you using for Wavo?";
    }
  }
  return text;
}
