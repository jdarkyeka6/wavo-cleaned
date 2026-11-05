import test from 'node:test'
import assert from 'node:assert/strict'
import { signVideoWavesPosts } from '../src/lib/wavesSignedUrls.js'

test('does not contact storage for an empty feed', async () => {
  const bucket = { createSignedUrls: () => { throw new Error('should not be called') } }
  assert.deepEqual(await signVideoWavesPosts(bucket, []), [])
  assert.deepEqual(await signVideoWavesPosts(bucket, [{ id: 1 }]), [])
})

test('batches 50 videos into one signing request while preserving order', async () => {
  const posts = Array.from({ length: 50 }, (_, i) => ({ id: i, media_path: 'friend/video-' + i }))
  const calls = []
  const bucket = {
    createSignedUrls: async (paths, ttl) => {
      calls.push({ paths, ttl })
      return { data: paths.map((path) => ({ path, signedUrl: 'signed:' + path })), error: null }
    },
  }
  const result = await signVideoWavesPosts(bucket, posts)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].paths.length, 50)
  assert.equal(calls[0].ttl, 900)
  assert.equal(result.length, 50)
  assert.deepEqual(result.map((post) => post.id), posts.map((post) => post.id))
  assert.equal(result[10].media_url_signed, 'signed:friend/video-10')
})

test('deduplicates paths and correctly signs duplicated references', async () => {
  const bucket = {
    createSignedUrls: async (paths) => {
      assert.deepEqual(paths, ['same/path'])
      return { data: [{ path: 'same/path', signedUrl: 'ok' }] }
    },
  }
  const signed = await signVideoWavesPosts(bucket, [{ id: 1, media_path: 'same/path' }, { id: 2, media_path: 'same/path' }])
  assert.deepEqual(signed.map((p) => p.media_url_signed), ['ok', 'ok'])
})

test('does not attach an incorrect URL when responses are reordered', async () => {
  const posts = [{ media_path: 'a' }, { media_path: 'b' }]
  const bucket = {
    createSignedUrls: async () => ({ data: [
      { path: 'b', signedUrl: 'signed-b' }, { path: 'a', signedUrl: 'signed-a' },
    ] }),
  }
  const signed = await signVideoWavesPosts(bucket, posts)
  assert.deepEqual(signed.map((p) => p.media_url_signed), ['signed-a', 'signed-b'])
})

test('skips unauthorized or missing media while keeping available videos', async () => {
  const bucket = {
    createSignedUrls: async () => ({ data: [
      { path: 'no', error: '403', signedUrl: null },
      { path: 'yes', signedUrl: 'signed-yes' },
    ] }),
  }
  assert.deepEqual(
    (await signVideoWavesPosts(bucket, [{ media_path: 'no' }, { media_path: 'yes' }])).map((p) => p.media_path),
    ['yes'],
  )
})

test('falls back to individual signing after a batch-level error', async () => {
  const paths = []
  const bucket = {
    createSignedUrls: async () => ({ data: null, error: new Error('batch temporarily unavailable') }),
    createSignedUrl: async (path) => {
      paths.push(path)
      if (path === 'bad') throw new Error('private')
      return { data: { signedUrl: 'signed:' + path } }
    },
  }
  const signed = await signVideoWavesPosts(bucket, [{ media_path: 'good' }, { media_path: 'bad' }])
  assert.deepEqual(paths.sort(), ['bad', 'good'])
  assert.deepEqual(signed.map((p) => p.media_path), ['good'])
})
