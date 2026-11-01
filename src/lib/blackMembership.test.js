import test from 'node:test'
import assert from 'node:assert/strict'
import { isBlackMember } from './blackMembership.js'

const now = Date.parse('2026-11-01T00:00:00Z')

for (const entitlement_source of ['founder', 'stripe_black', 'apple_black']) {
  test(`${entitlement_source} has Black membership while premium is active`, () => {
    assert.equal(isBlackMember({ entitlement_source, is_premium: true, premium_until: null }, now), true)
  })
}

test('non-Black or inactive entitlements cannot receive Black membership', () => {
  for (const entitlement_source of ['admin', 'internal', 'stripe', 'stripe_plus', 'apple', null]) {
    assert.equal(isBlackMember({ entitlement_source, is_premium: true }, now), false)
  }
  assert.equal(isBlackMember({ entitlement_source: 'founder', is_premium: false }, now), false)
  assert.equal(isBlackMember({ entitlement_source: 'founder', is_premium: true, premium_until: '2026-10-01T00:00:00Z' }, now), false)
  assert.equal(isBlackMember({ entitlement_source: 'founder', is_premium: true, premium_until: 'not-a-date' }, now), false)
})

test('founder remains Black before, but not after, expiration', () => {
  const profile = { entitlement_source: 'founder', is_premium: true, premium_until: '2026-11-02T00:00:00Z' }
  assert.equal(isBlackMember(profile, now), true)
  assert.equal(isBlackMember(profile, Date.parse('2026-11-02T00:00:00Z')), false)
})
