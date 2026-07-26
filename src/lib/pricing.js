// src/lib/pricing.js
//
// SINGLE SOURCE OF TRUTH for Wavo Premium pricing.
//
// The paywall drifted to "$2/mo" in three places because the price was
// hardcoded as copy in three different strings. Nothing in the UI should
// ever contain a literal dollar figure again — import from here instead.
//
// If a price changes: edit it ONCE, below. The subtitle, the plan card,
// and the checkout button all follow automatically.

// KEEP IN SYNC with the PLANS table in api/checkout.js, which holds the same
// amounts in cents and is what Stripe actually charges. The API builds each
// line item with inline `price_data`, so there are no Stripe price IDs to
// configure — an earlier version of this file referenced
// VITE_STRIPE_PRICE_STANDARD / _STUDENT env vars that nothing ever read.
export const CURRENCY = 'AUD';

export const PLANS = {
  standard: {
    id: 'standard',
    label: 'Premium',
    price: 4.99,
    blurb: 'Keeps the lights on.',
    requiresStudentDeclaration: false,
  },
  student: {
    id: 'student',
    label: 'Student',
    price: 3.49,
    blurb: 'Same everything, cheaper if you\'re at school.',
    // Honour system — no verification, just a declaration at checkout.
    requiresStudentDeclaration: true,
  },
};

export const DEFAULT_PLAN = 'standard';

/** Plan lookup that never returns undefined. */
export function getPlan(id) {
  return PLANS[id] ?? PLANS[DEFAULT_PLAN];
}

/**
 * Format a price for display: 4.99 -> "$4.99", 2 -> "$2"
 * Trailing ".00" is dropped so round numbers read cleanly.
 */
export function formatPrice(amount) {
  return `$${amount.toFixed(2).replace(/\.00$/, '')}`;
}

/** "$4.99/mo" */
export function formatMonthly(amount) {
  return `${formatPrice(amount)}/mo`;
}

/** "$4.99/mo" for a plan id — the one most components want. */
export function planPrice(id) {
  return formatMonthly(getPlan(id).price);
}

/**
 * Copy for the paywall subtitle. Derived, not hardcoded, so it can't
 * contradict the button underneath it.
 */
export function priceSubtitle(id = DEFAULT_PLAN) {
  const plan = getPlan(id);
  return `${formatMonthly(plan.price)}. ${plan.blurb}`;
}

/** Plan ids the checkout API will accept. */
export const PLAN_IDS = Object.keys(PLANS);
