import test from 'node:test'
import assert from 'node:assert/strict'
import { sortInboxFriends } from '../src/lib/inboxActivity.js'

test('unread conversations come first, newest first inside each group', () => {
  const friends = ['alice','bob','carol','dan','eve'].map(id => ({ id, username: id }))
  const activity = {
    alice: { latestAt: '2026-11-14T10:00:00Z', unread: false },
    bob: { latestAt: '2026-11-14T08:00:00Z', unread: true },
    carol: { latestAt: '2026-11-14T09:00:00Z', unread: true },
    dan: { latestAt: '2026-11-14T07:00:00Z', unread: false },
  }
  assert.deepEqual(sortInboxFriends(friends, activity).map(f => f.id), ['carol','bob','alice','dan','eve'])
  activity.bob.unread = false
  assert.deepEqual(sortInboxFriends(friends, activity).map(f => f.id), ['carol','alice','bob','dan','eve'])
  assert.equal(friends[0].id, 'alice')
})
