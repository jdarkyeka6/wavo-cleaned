// Pure offer policy. No Stripe mutations or user profiling happen here.
// Eligibility is determined by trusted server-side billing history, never by a client flag.
export const RETENTION_OFFERS = Object.freeze({
  standard: Object.freeze({ percentOff: 20, durationMonths: 3 }),
  loyal: Object.freeze({ percentOff: 50, durationMonths: 3 }),
});
export const WELCOME_OFFER = Object.freeze({ percentOff: 50, durationMonths: 1 });

export function selectRetentionOffer({ reason, eligible, loyal } = {}) {
  if (reason !== 'too_expensive' || eligible !== true) return null;
  return loyal === true ? RETENTION_OFFERS.loyal : RETENTION_OFFERS.standard;
}

export function isWelcomeEligible({ previousPaidSubscriptions, alreadyRedeemed } = {}) {
  return previousPaidSubscriptions === 0 && alreadyRedeemed === false;
}

export function discountedMinorUnits(amount, percentOff) {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new TypeError('Invalid amount');
  if (![20, 50].includes(percentOff)) throw new TypeError('Unsupported discount');
  return Math.round(amount * (100 - percentOff) / 100);
}
