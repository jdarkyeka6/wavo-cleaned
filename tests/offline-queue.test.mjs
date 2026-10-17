import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { queueOutbox, getOutbox, removeOutboxItem, updateOutboxItem, cacheMessages, loadCachedMessages, setDraft, getDraft } from '../src/offline.js'

class LocalStorageStub {
  constructor() { this.values = new Map() }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
}

beforeEach(() => {
  globalThis.localStorage = new LocalStorageStub()
  globalThis.window = new EventTarget()
})

test('Outbox idempotency: timeout retries cannot queue one message twice', () => {
  const id = '00000000-0000-4000-8000-000000000001'
  const message = { id, kind: 'dm', targetId: 'friend', content: 'Hello' }
  const first = queueOutbox('user1', message)
  const retry = queueOutbox('user1', message)
  assert.equal(first.id, retry.id)
  assert.equal(getOutbox('user1').length, 1)
  assert.equal(getOutbox('user1')[0].content, 'Hello')
})

test('Pending and blocked messages are separated by account and editable', () => {
  const id = '00000000-0000-4000-8000-000000000002'
  queueOutbox('user1', { id, kind: 'space', targetId: 'group', content: 'Draft' })
  assert.deepEqual(getOutbox('user2'), [])
  assert.equal(updateOutboxItem('user1', id, { status: 'blocked' }), true)
  assert.equal(getOutbox('user1')[0].status, 'blocked')
  assert.equal(removeOutboxItem('user1', id), true)
  assert.deepEqual(getOutbox('user1'), [])
})

test('Offline persistence failures leave drafts to recover from', () => {
  localStorage.setItem = () => { throw new Error('Quota exceeded') }
  assert.throws(() =>
    queueOutbox('user1', { id: '00000000-0000-4000-8000-000000000003', content: 'Hello' }),
    /Offline storage is full/,
  )
})

test('Outbox emits update events for UI to react to', () => {
  let changes = 0
  window.addEventListener('wavo:outbox-changed', () => changes++)
  const id = '00000000-0000-4000-8000-000000000004'
  queueOutbox('user1', { id, content: 'Retry me' })
  updateOutboxItem('user1', id, { checked: true })
  removeOutboxItem('user1', id)
  assert.equal(changes, 3)
})

test('Recent history is capped and drafts persist locally', () => {
  cacheMessages('user1', 'dm:friend', Array.from({ length: 400 }, (_, i) => ({ id: i })))
  const recent = loadCachedMessages('user1', 'dm:friend')
  assert.equal(recent.length, 300)
  assert.equal(recent[0].id, 100)
  assert.equal(setDraft('user1', 'dm:friend', 'Not sent'), true)
  assert.equal(getDraft('user1', 'dm:friend'), 'Not sent')
})
