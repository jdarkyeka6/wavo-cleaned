import test from 'node:test'
import assert from 'node:assert/strict'
import { isAppPath } from '../src/lib/appRoutes.js'

test('current and legacy routes continue to open the application', () => {
  for (const path of ['/', '/home', '/inbox', '/messages', '/spaces', '/groups', '/profile', '/you', '/settings', '/subscriptions', '/login', '/signup', '/chat/bob', '/chats/Bob', '/space/My%20Space', '/chat/bob/']) {
    assert.equal(isAppPath(path), true, path)
  }
})

test('unknown routes and unexpected nested paths show the 404 page', () => {
  for (const path of ['/not-a-page', '/home/extra', '/chat/bob/extra', '/assets/missing.js']) {
    assert.equal(isAppPath(path), false, path)
  }
})
