import { supabase } from './supabaseClient'
import { isNativeApp } from './lib/platform'

export const CURATED_CHANNELS = [
  { slug: 'funny', handle: 'wavesfunny', name: 'Funny', emoji: '😂' },
  { slug: 'animals', handle: 'wavesanimals', name: 'Animals', emoji: '🐾' },
  { slug: 'gaming', handle: 'wavesgaming', name: 'Gaming', emoji: '🎮' },
  { slug: 'cars', handle: 'wavescars', name: 'Cars', emoji: '🏎️' },
  { slug: 'travel', handle: 'wavestravel', name: 'Travel', emoji: '🌍' },
  { slug: 'satisfying', handle: 'wavessatisfying', name: 'Satisfying', emoji: '✨' },
]
export const channelBySlug = Object.fromEntries(CURATED_CHANNELS.map((channel) => [channel.slug, channel]))

export function postKey(post) {
  return (post.kind === 'curated' ? 'curated:' : 'friend:') + post.id
}

export function rotateCuratedFeed(friendPosts, curatedPosts) {
  // Preserve private friend posts as their own channel. Rotate themed queues to
  // avoid a flood of one subject or pretending a curated channel is a real creator.
  const pools = new Map()
  for (const post of curatedPosts) {
    const slug = post.channel_slug
    if (!pools.has(slug)) pools.set(slug, [])
    pools.get(slug).push(post)
  }
  const friends = [...friendPosts]
  const channels = CURATED_CHANNELS.map((entry) => entry.slug).filter((slug) => pools.get(slug)?.length)
  const result = []
  let lastChannel = null
  let rotation = 0
  while (friends.length || channels.some((slug) => pools.get(slug)?.length)) {
    // Interleave a friend upload every fourth slot, if available.
    if (friends.length && (result.length % 4 === 0 || !channels.some((slug) => pools.get(slug)?.length))) {
      result.push(friends.shift())
      lastChannel = 'friends'
      continue
    }
    const choices = channels.filter((slug) => pools.get(slug)?.length && slug !== lastChannel)
    const remaining = choices.length ? choices : channels.filter((slug) => pools.get(slug)?.length)
    if (!remaining.length) {
      if (!friends.length) break
      result.push(friends.shift())
      lastChannel = 'friends'
      continue
    }
    const slug = remaining[rotation % remaining.length]
    result.push(pools.get(slug).shift())
    lastChannel = slug
    rotation += 1
  }
  return result
}

export async function loadCuratedWaves(page = 0) {
  // Published clips are fetched in channel-balanced pages under RLS. A huge
  // Funny import cannot bury every Animals or Travel clip behind 1,400 videos.
  const { data, error } = await supabase.rpc('waves_curated_feed_page', {
    p_page: page, p_per_channel: 15,
  })
  if (error) throw error
  const clips = data || []
  if (!clips.length) return []
  const { data: likes, error: likeError } = await supabase.from('waves_curated_likes')
    .select('clip_id,user_id').in('clip_id', clips.map((clip) => clip.id))
  if (likeError) throw likeError
  const likesByClip = new Map()
  for (const like of likes || []) {
    if (!likesByClip.has(like.clip_id)) likesByClip.set(like.clip_id, [])
    likesByClip.get(like.clip_id).push(like)
  }
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData?.session?.access_token
  const signed = await Promise.all(clips.map(async (clip) => {
    let playbackUrl = clip.video_provider === 'google_drive'
      ? null
      : (clip.playback_url || null)
    if (clip.video_provider === 'google_drive' && clip.video_asset_id) {
      // Published curated clips support guest playback. Add the session token
      // only when one exists so the same feed works signed in and signed out.
      const proxyOrigin = isNativeApp ? 'https://wavowaves.lol' : ''
      const tokenParam = token ? `&token=${encodeURIComponent(token)}` : ''
      playbackUrl = `${proxyOrigin}/api/waves-video?id=${encodeURIComponent(clip.id)}${tokenParam}`
    }
    if (!playbackUrl && clip.media_path) {
      const { data: url, error: signError } = await supabase.storage.from('waves-curated')
        .createSignedUrl(clip.media_path, 15 * 60)
      if (signError || !url?.signedUrl) return null
      playbackUrl = url.signedUrl
    }
    if (!playbackUrl && !clip.playback_hls_url) return null
    const channel = channelBySlug[clip.channel_slug]
    if (!channel) return null
    return {
      kind: 'curated',
      id: clip.id,
      channel_slug: clip.channel_slug,
      title: clip.title,
      body: clip.caption,
      source_credit: clip.source_credit,
      tags: clip.tags || [],
      created_at: clip.published_at,
      media_url_signed: playbackUrl,
      media_hls_url: clip.playback_hls_url || null,
      video_provider: clip.video_provider || (clip.media_path ? 'supabase' : 'external'),
      author: { username: channel.handle },
      reactions: likesByClip.get(clip.id) || [],
    }
  }))
  return signed.filter(Boolean)
}
