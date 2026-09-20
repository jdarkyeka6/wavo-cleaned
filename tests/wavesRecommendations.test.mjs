import test from 'node:test'
import assert from 'node:assert/strict'
import { rankWavesFeed } from '../src/wavesRecommendations.js'

const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
const clip = (n, channel_slug) => ({ kind: 'curated', id: id(n), channel_slug, created_at: '2026-09-20T00:00:00.000Z' })
const friend = (n) => ({ kind: 'friend', id: id(n), created_at: '2026-09-20T00:00:00.000Z' })
const fixedNow = Date.parse('2026-09-20T12:00:00.000Z')
const rank = (friends, curated, signals = [], choices = [], saved = []) =>
  rankWavesFeed(friends, curated, signals, choices, saved, fixedNow)

test('fresh accounts get a mixed feed with friends at regular intervals', () => {
  const friends = [friend(101), friend(102)]
  const curated = [clip(1, 'funny'), clip(2, 'animals'), clip(3, 'funny'), clip(4, 'gaming'), clip(5, 'animals'), clip(6, 'cars')]
  const result = rank(friends, curated)
  assert.equal(result.length, 8)
  assert.equal(result[0].id, friends[0].id)
  assert.equal(result[4].id, friends[1].id)
  assert.deepEqual(new Set(result.map((post) => post.id)), new Set([...friends, ...curated].map((post) => post.id)))
  assert.notEqual(result[1].channel_slug, result[2].channel_slug)
})

test('liking and saving one channel boosts fresh videos from that channel', () => {
  const candidates = [clip(1, 'animals'), clip(2, 'funny'), clip(3, 'cars')]
  const signals = [{ video_key: 'curated:' + id(90), channel_slug: 'funny', liked: true, saved: true, plays: 1 }]
  assert.equal(rank([], candidates, signals)[0].channel_slug, 'funny')
})

test('short skips reduce preference and valid completions and rewatches raise it', () => {
  const candidates = [clip(1, 'funny'), clip(2, 'animals')]
  const skip = [{ video_key: 'curated:' + id(90), channel_slug: 'funny', plays: 5, skips: 5 }]
  assert.equal(rank([], candidates, skip)[0].channel_slug, 'animals')
  const complete = [{ video_key: 'curated:' + id(90), channel_slug: 'animals', plays: 3, completions: 3, rewatches: 2, watched_ms: 40000 }]
  assert.equal(rank([], candidates, complete)[0].channel_slug, 'animals')
})

test('choosing a channel influences For You without hiding other channels', () => {
  const candidates = [clip(1, 'funny'), clip(2, 'travel'), clip(3, 'cars')]
  const result = rank([], candidates, [], [{ channel_slug: 'travel', visits: 2 }])
  assert.equal(result[0].channel_slug, 'travel')
  assert.equal(result.length, candidates.length)
})

test('previously watched individual videos do not crowd out fresh clips', () => {
  const old = clip(1, 'funny')
  const fresh = clip(2, 'funny')
  const signals = [{ video_key: 'curated:' + old.id, channel_slug: 'funny', plays: 5, completions: 3, watched_ms: 25000 }]
  assert.equal(rank([], [old, fresh], signals)[0].id, fresh.id)
})

test('only supplied accessible friend posts enter the ranked feed', () => {
  const accessible = friend(101)
  const result = rank([accessible], [clip(1, 'animals')], [{ video_key: 'friend:' + id(999), plays: 20, liked: true }])
  assert.equal(result.length, 2)
  assert.equal(result[0].id, accessible.id)
})


test('hidden tags carry interests across different channels', () => {
  const liked = { ...clip(90, 'funny'), tags: ['dogs', 'pets'] }
  const dogTravel = { ...clip(1, 'travel'), tags: ['dogs', 'outdoors'] }
  const unrelatedFunny = { ...clip(2, 'funny'), tags: ['fails'] }
  const signals = [{ video_key: 'curated:' + liked.id, channel_slug: 'funny', liked: true, saved: true, plays: 1 }]
  const result = rank([], [liked, dogTravel, unrelatedFunny], signals)
  assert.equal(result[0].id, dogTravel.id)
})
