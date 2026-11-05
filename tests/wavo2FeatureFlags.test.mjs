import test from 'node:test';
import assert from 'node:assert/strict';
import { WAVO2_FLAGS, resolveWavo2Flags, isWavo2FeatureEnabled } from '../src/lib/wavo2FeatureFlags.js';

test('every launch feature is disabled by default', () => {
  assert.deepEqual(Object.values(WAVO2_FLAGS), [false, false, false, false, false]);
});

test('missing, invalid, and unknown remote values cannot activate features', () => {
  const flags = resolveWavo2Flags({
    play_enabled: 'true',
    discover_enabled: 1,
    identity_v2_enabled: null,
    unexpected_key: true,
  });
  assert.deepEqual(flags, WAVO2_FLAGS);
  assert.equal(isWavo2FeatureEnabled('unexpected_key', { unexpected_key: true }), false);
});

test('an explicit boolean true can enable only the named feature', () => {
  const flags = resolveWavo2Flags({ play_enabled: true });
  assert.equal(isWavo2FeatureEnabled('play_enabled', flags), true);
  assert.equal(isWavo2FeatureEnabled('discover_enabled', flags), false);
});

test('null or malformed remote configuration defaults to off', () => {
  assert.deepEqual(resolveWavo2Flags(null), WAVO2_FLAGS);
  assert.deepEqual(resolveWavo2Flags([]), WAVO2_FLAGS);
});
