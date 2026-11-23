import test from 'node:test';
import assert from 'node:assert/strict';
import { selectRetentionOffer, isWelcomeEligible, discountedMinorUnits } from '../src/lib/retentionOffers.js';

test('only eligible price-sensitive cancellation receives an offer', () => {
  assert.deepEqual(selectRetentionOffer({ reason: 'too_expensive', eligible: true, loyal: false }), { percentOff: 20, durationMonths: 3 });
  assert.deepEqual(selectRetentionOffer({ reason: 'too_expensive', eligible: true, loyal: true }), { percentOff: 50, durationMonths: 3 });
  assert.equal(selectRetentionOffer({ reason: 'missing_features', eligible: true, loyal: true }), null);
  assert.equal(selectRetentionOffer({ reason: 'too_expensive', eligible: false, loyal: true }), null);
  assert.equal(selectRetentionOffer({ reason: 'too_expensive', loyal: true }), null);
});

test('welcome eligibility must be positively established', () => {
  assert.equal(isWelcomeEligible({ previousPaidSubscriptions: 0, alreadyRedeemed: false }), true);
  assert.equal(isWelcomeEligible({ previousPaidSubscriptions: 1, alreadyRedeemed: false }), false);
  assert.equal(isWelcomeEligible({ previousPaidSubscriptions: 0, alreadyRedeemed: true }), false);
  assert.equal(isWelcomeEligible({}), false);
});

test('discount arithmetic rounds in minor currency units', () => {
  assert.equal(discountedMinorUnits(999, 20), 799);
  assert.equal(discountedMinorUnits(999, 50), 500);
  assert.throws(() => discountedMinorUnits(-1, 20));
  assert.throws(() => discountedMinorUnits(999, 99));
});
