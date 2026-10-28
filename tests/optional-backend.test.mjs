import test from 'node:test'
import assert from 'node:assert/strict'
import { createOptionalBackendGate, isMissingOptionalBackendObject } from '../src/lib/optionalBackend.js'

test('only missing schema objects are treated as unavailable', () => {
  for (const code of ['PGRST202', 'PGRST205', '42P01', '42883']) {
    assert.equal(isMissingOptionalBackendObject({ code }), true)
  }
  for (const code of ['42501', 'PGRST116', 'PGRST301', '08006']) {
    assert.equal(isMissingOptionalBackendObject({ code }), false)
  }
})

test('missing features back off independently and retry after five minutes', () => {
  const gate = createOptionalBackendGate()
  assert.equal(gate.markMissing('presence', { code: 'PGRST205' }, 1000), true)
  assert.equal(gate.unavailable('presence', 1001), true)
  assert.equal(gate.unavailable('dm_polls', 1001), false)
  assert.equal(gate.unavailable('presence', 301000), false)
})

test('authorization failures are not hidden', () => {
  const gate = createOptionalBackendGate()
  assert.equal(gate.markMissing('presence', { code: '42501' }, 1000), false)
  assert.equal(gate.unavailable('presence', 1001), false)
})
