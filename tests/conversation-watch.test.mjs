import test from 'node:test'
import assert from 'node:assert/strict'
import { watchConversationChanges } from '../src/lib/conversationWatch.js'

test('navigation events refresh the current chat immediately', () => {
  const target = new EventTarget()
  let resolves = 0
  let callback
  let intervalMs
  let stopped = false
  const cleanup = watchConversationChanges(target, () => { resolves += 1 }, {
    startInterval: (fn, ms) => { callback = fn; intervalMs = ms; return 1 },
    stopInterval: (id) => { assert.equal(id, 1); stopped = true },
  })
  assert.equal(intervalMs, 30000)
  assert.equal(resolves, 0)
  target.dispatchEvent(new Event('wavo:conversation-change'))
  assert.equal(resolves, 1)
  callback()
  assert.equal(resolves, 2)
  cleanup()
  assert.equal(stopped, true)
  target.dispatchEvent(new Event('wavo:conversation-change'))
  assert.equal(resolves, 2)
})

test('switching user/chat listeners removes stale callbacks', () => {
  const target = new EventTarget()
  let callsA = 0
  let callsB = 0
  const timers = new Map()
  let nextId = 0
  const options = {
    startInterval: (fn) => { const id = ++nextId; timers.set(id, fn); return id },
    stopInterval: (id) => { timers.delete(id) },
  }
  const stopA = watchConversationChanges(target, () => callsA++, options)
  stopA()
  const stopB = watchConversationChanges(target, () => callsB++, options)
  target.dispatchEvent(new Event('wavo:conversation-change'))
  assert.equal(callsA, 0)
  assert.equal(callsB, 1)
  assert.equal(timers.size, 1)
  stopB()
  assert.equal(timers.size, 0)
})
