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

export const CURRENCY = 'AUD';

export const PLANS = {
  standard: {
    id: 'standard',
    label: 'Premium',
    price: 4.99,
    priceId: import.meta.env.VITE_STRIPE_PRICE_STANDARD,
    blurb: 'Keeps the lights on.',
    requiresStudentDeclaration: false,
  },
  student: {
    id: 'student',
    label: 'Student',
    price: 3.49,
    priceId: import.meta.env.VITE_STRIPE_PRICE_STUDENT,
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

/**
 * Fails loudly in dev if the Stripe price IDs aren't wired up, rather
 * than silently sending an undefined priceId to checkout.
 */
export function assertPricingConfigured() {
  const missing = Object.values(PLANS)
    .filter((p) => !p.priceId)
    .map((p) => p.id);

  if (missing.length && import.meta.env.DEV) {
    console.error(
      `[wavo] Missing Stripe price ID env vars for: ${missing.join(', ')}. ` +
      'Check VITE_STRIPE_PRICE_STANDARD / VITE_STRIPE_PRICE_STUDENT.'
    );
  }
  return missing.length === 0;
}
