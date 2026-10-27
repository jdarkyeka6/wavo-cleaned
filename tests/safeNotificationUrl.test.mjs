import test from 'node:test';
import assert from 'node:assert/strict';
import { safeNotificationUrl } from '../src/lib/safeNotificationUrl.js';

test('allows internal application routes', () => {
  assert.equal(safeNotificationUrl('/'), '/');
  assert.equal(safeNotificationUrl('/chat?room=123#latest'), '/chat?room=123#latest');
});

test('rejects external and scheme-relative destinations', () => {
  for (const value of ['https://example.com', 'http://example.com', '//example.com', '///example.com', '\\\\example.com', '/\\example.com', 'javascript:alert(1)', null, 45]) {
    assert.equal(safeNotificationUrl(value), null);
  }
});

test('rejects controls in notification destinations', () => {
  assert.equal(safeNotificationUrl('/chat\n//example.com'), null);
  assert.equal(safeNotificationUrl('/chat\rredirect'), null);
});
