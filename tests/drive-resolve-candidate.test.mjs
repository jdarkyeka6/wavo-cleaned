import test from 'node:test'
import assert from 'node:assert/strict'
import { pickDriveUploadCandidate } from '../api/lib/driveResolveCandidate.js'

const userId = 'account-a'
const size = 42
const cutoff = Date.parse('2026-10-31T12:00:00Z')
const owned = (id, name, extras = {}) => ({
  id, name, size, createdTime: '2026-10-31T12:10:00Z',
  appProperties: { wavoUserId: userId, wavoSource: 'chat' },
  ...extras,
})
const find = (files, name = 'photo.jpeg') => pickDriveUploadCandidate(files, { userId, fileName: name, size, cutoff })

test('recovers the exact user-owned filename from several same-sized uploads', () => {
  assert.deepEqual(find([owned('one', 'something.mov'), owned('two', 'photo.jpeg')]), { fileId: 'two', ambiguous: false })
})

test('refuses ambiguous same-sized uploads instead of returning an unrelated file', () => {
  assert.deepEqual(find([owned('one', 'other.jpeg'), owned('two', 'another.jpeg')]), { fileId: null, ambiguous: true })
})

test('refuses duplicate matching filenames with identical sizes', () => {
  assert.deepEqual(find([owned('one', 'photo.jpeg'), owned('two', 'photo.jpeg')]), { fileId: null, ambiguous: true })
})

test('allows legacy iOS filename normalisation only when there is one candidate', () => {
  assert.deepEqual(find([owned('one', 'IMG_1010.HEIC')]), { fileId: 'one', ambiguous: false })
})

test('normalises Unicode filenames for equivalent text', () => {
  assert.deepEqual(find([owned('one', 'cafe\u0301.png')], 'café.png'), { fileId: 'one', ambiguous: false })
})

test('never returns another user’s file, even if the name and size match', () => {
  assert.deepEqual(find([
    owned('foreign', 'photo.jpeg', { appProperties: { wavoUserId: 'account-b', wavoSource: 'chat' } }),
  ]), { fileId: null, ambiguous: false })
})

test('rejects an unrelated Drive file despite a matching owner', () => {
  assert.deepEqual(find([
    owned('foreign', 'photo.jpeg', { appProperties: { wavoUserId: userId, wavoSource: 'waves-curated' } }),
  ]), { fileId: null, ambiguous: false })
})

test('ignores stale, wrong-sized and missing-ID Drive responses', () => {
  assert.deepEqual(find([
    owned('stale', 'photo.jpeg', { createdTime: '2026-10-31T11:00:00Z' }),
    owned('wrong-size', 'photo.jpeg', { size: 300 }),
    owned('', 'photo.jpeg'),
  ]), { fileId: null, ambiguous: false })
})

test('rejects invalid request constraints and unexpected Drive payloads', () => {
  assert.deepEqual(find(null), { fileId: null, ambiguous: false })
  assert.deepEqual(pickDriveUploadCandidate([owned('one', 'photo.jpeg')], { userId, size: 0, fileName: 'photo.jpeg', cutoff }), { fileId: null, ambiguous: false })
})
