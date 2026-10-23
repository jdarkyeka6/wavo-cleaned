import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  queueOutbox, getOutbox, removeOutboxItem, updateOutboxItem,
  cacheMessages, loadCachedMessages, setDraft, getDraft,
} from '../src/offline.js'

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

test('retrying the same message UUID does not duplicate or mutate the queued message', () => {
  const id = '00000000-0000-4000-8000-000000000001'
  let updates = 0
  window.addEventListener('wavo:outbox-changed', () => updates++)
  const first = queueOutbox('user1', { id, kind: 'dm', targetId: 'friend1', content: 'Hello' })
  const second = queueOutbox('user1', { id, kind: 'dm', targetId: 'friend2', content: 'Different payload' })
  assert.deepEqual(second, first)
  assert.equal(getOutbox('user1').length, 1)
  assert.equal(getOutbox('user1')[0].targetId, 'friend1')
  assert.equal(getOutbox('user1')[0].queuedAt, first.queuedAt)
  assert.equal(updates, 1)
})

test('queue changes are isolated per account', () => {
  const id = '00000000-0000-4000-8000-000000000002'
  queueOutbox('user1', { id, kind: 'space', targetId: 'group1', content: 'Draft' })
  assert.deepEqual(getOutbox('user2'), [])
  assert.equal(updateOutboxItem('user2', id, { status: 'blocked' }), false)
  assert.equal(updateOutboxItem('user1', id, { status: 'blocked', id: 'forged' }), true)
  assert.equal(getOutbox('user1')[0].id, id)
  assert.equal(removeOutboxItem('user1', id), true)
  assert.deepEqual(getOutbox('user1'), [])
})

test('a failed storage write never silently queues a message', () => {
  localStorage.setItem = () => { throw new Error('Quota exceeded') }
  assert.throws(() =>
    queueOutbox('user1', { id: '00000000-0000-4000-8000-000000000003', content: 'Hello' }),
    /Offline storage is full/,
  )
  assert.deepEqual(getOutbox('user1'), [])
})

test('a failed storage removal reports failure and keeps the queued item', () => {
  const id = '00000000-0000-4000-8000-000000000004'
  queueOutbox('user1', { id, content: 'Do not lose me' })
  localStorage.setItem = () => { throw new Error('Storage disabled') }
  assert.equal(removeOutboxItem('user1', id), false)
  assert.equal(getOutbox('user1')[0].content, 'Do not lose me')
})

test('outbox change events fire on persisted queue, edit, and remove', () => {
  const id = '00000000-0000-4000-8000-000000000005'
  let events = 0
  window.addEventListener('wavo:outbox-changed', () => events++)
  queueOutbox('user1', { id, content: 'Queued' })
  updateOutboxItem('user1', id, { status: 'retry' })
  removeOutboxItem('user1', id)
  assert.equal(events, 3)
})

test('recent messages and drafts retain previous storage behaviour', () => {
  cacheMessages('user1', 'dm:friend', Array.from({ length: 400 }, (_, i) => ({ id: i })))
  const recent = loadCachedMessages('user1', 'dm:friend')
  assert.equal(recent.length, 300)
  assert.equal(recent[0].id, 100)
  assert.equal(setDraft('user1', 'dm:friend', 'Not sent'), true)
  assert.equal(getDraft('user1', 'dm:friend'), 'Not sent')
})
