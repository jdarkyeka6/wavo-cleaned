// A transparent, per-account ranking model. It never expands the audience of a
// private post: callers must supply only posts already visible to the viewer.
const cap = (value, low, high) => Math.max(low, Math.min(high, value))
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0

export function rankWavesFeed(friendPosts, curatedPosts, signals = [], channelChoices = [], savedKeys = [], now = Date.now()) {
  const byKey = new Map(signals.map((signal) => [signal.video_key, signal]))
  const saved = new Set(savedKeys)
  const interests = new Map()
  const tagInterests = new Map()
  const postByKey = new Map(curatedPosts.map((post) => ['curated:' + post.id, post]))
  for (const signal of signals) {
    if (!signal.channel_slug) continue
    const plays = cap(number(signal.plays), 0, 1000)
    const completes = cap(number(signal.completions), 0, 20)
    const skips = cap(number(signal.skips), 0, 20)
    const rewatches = cap(number(signal.rewatches), 0, 20)
    const feedback = (signal.liked ? 3.4 : 0) + (signal.saved ? 3 : 0)
      + Math.min(completes, 3) * 1.1 + Math.min(rewatches, 3) * 1.2
      + Math.min(4, number(signal.watched_ms) / 12000) * 0.35
      - Math.min(skips, 5) * 1.65
    if (!plays && !signal.liked && !signal.saved && !completes && !rewatches && !skips) continue
    const previous = interests.get(signal.channel_slug) || { total: 0, items: 0 }
    previous.total += cap(feedback, -6, 11)
    previous.items += 1
    interests.set(signal.channel_slug, previous)
    const sourcePost = postByKey.get(signal.video_key)
    for (const tag of (signal.tags?.length ? signal.tags : sourcePost?.tags || [])) {
      const tagPrevious = tagInterests.get(tag) || { total: 0, items: 0 }
      tagPrevious.total += cap(feedback, -6, 11)
      tagPrevious.items += 1
      tagInterests.set(tag, tagPrevious)
    }
  }

  const choiceBonus = new Map(channelChoices.map(({ channel_slug, visits }) => [
    channel_slug, cap(0.95 + Math.log1p(Math.max(0, number(visits))) * 0.7, 0, 2.6),
  ]))
  const channelScore = (slug) => {
    const preference = interests.get(slug)
    const learned = preference ? cap(preference.total / (preference.items + 2), -3, 4.5) : 0
    return learned * 1.35 + (choiceBonus.get(slug) || 0)
  }
  function tagScore(post) {
    const scores = (post.tags || []).map((tag) => {
      const preference = tagInterests.get(tag)
      return preference ? cap(preference.total / (preference.items + 2), -3, 4.5) : 0
    })
    return scores.length ? scores.sort((a, b) => b - a).slice(0, 3).reduce((sum, value) => sum + value, 0) * 0.9 : 0
  }
  function baseScore(post) {
    const key = (post.kind === 'curated' ? 'curated:' : 'friend:') + post.id
    const signal = byKey.get(key) || {}
    const age = Math.max(0, now - new Date(post.created_at || now).getTime()) / 86400000
    const fresh = Number.isFinite(age) ? 1.8 * Math.exp(-age / 21) : 0
    const plays = cap(number(signal.plays), 0, 1000)
    const positive = (signal.liked ? 1 : 0) + (signal.saved || saved.has(key) ? 1.1 : 0)
    const unseenBoost = plays ? 0 : 1.6
    // Seen clips remain available, but unseen clips get the earlier slots.
    const seenPenalty = plays ? Math.min(5, 1.2 + plays * 0.65 + number(signal.completions) * 0.55) : 0
    return fresh + positive + unseenBoost - seenPenalty
  }

  const friends = [...friendPosts].sort((a, b) => baseScore(b) - baseScore(a))
  const curated = [...curatedPosts].map((post) => ({ post, base: baseScore(post) }))
  const result = []
  const shownByChannel = new Map()
  let lastChannel = ''
  let curatedCount = 0

  while (friends.length || curated.length) {
    // Friends stay in their established slots, not buried by curated engagement.
    if (friends.length && (result.length % 4 === 0 || !curated.length)) {
      result.push(friends.shift())
      lastChannel = ''
      continue
    }
    let bestIndex = -1
    let bestScore = -Infinity
    for (let i = 0; i < curated.length; i += 1) {
      const { post, base } = curated[i]
      const slug = post.channel_slug
      const shown = shownByChannel.get(slug) || 0
      const diversityPenalty = shown * 0.35 + (slug === lastChannel ? 2.5 : 0)
      // Every sixth curated slot deliberately explores a less-shown channel.
      const exploreBonus = curatedCount % 6 === 5 ? 2.5 / (1 + shown) : 0
      const score = base + channelScore(slug) + tagScore(post) - diversityPenalty + exploreBonus
      if (score > bestScore) { bestScore = score; bestIndex = i }
    }
    const [chosen] = curated.splice(bestIndex, 1)
    result.push(chosen.post)
    shownByChannel.set(chosen.post.channel_slug, (shownByChannel.get(chosen.post.channel_slug) || 0) + 1)
    lastChannel = chosen.post.channel_slug
    curatedCount += 1
  }
  return result
}
