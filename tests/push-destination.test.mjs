import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePushDestination } from '../src/lib/pushDestination.js'

const origin = 'https://wavo.lol'

test('valid DM and Space destinations preserve native navigation', () => {
  assert.equal(parsePushDestination('/chat/Abby', origin), '/chat/Abby')
  assert.equal(parsePushDestination('/space/My%20Space', origin), '/space/My%20Space')
  assert.equal(parsePushDestination('/chat/Abby?source=push', origin), '/chat/Abby')
})

test('legacy chat links and generic notifications fall back safely', () => {
  assert.equal(parsePushDestination('/chats/Abby', origin), '/chat/Abby')
  assert.equal(parsePushDestination('/chats', origin), '/inbox')
  assert.equal(parsePushDestination('/messages', origin), '/inbox')
  assert.equal(parsePushDestination('/inbox', origin), '/inbox')
})

test('external, malformed and unsupported destinations cannot navigate native app', () => {
  for (const value of [
    null, '', 'https://evil.example/chat/Abby', '//evil.example/x',
    '/\\evil.example', '/chat/', '/space/', '/settings', '/chat/..',
  ]) {
    assert.equal(parsePushDestination(value, origin), null, String(value))
  }
})
