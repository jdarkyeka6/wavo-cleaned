import { supabase } from './supabaseClient'

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

export async function loadCuratedWaves() {
  // The table RLS returns published rows to signed-in members, never review
  // notes or source Drive URLs. Storage RLS likewise restricts signing URLs.
  const { data, error } = await supabase.from('waves_curated_clips')
    .select('id,channel_slug,title,caption,media_path,playback_url,playback_hls_url,video_provider,video_asset_id,source_credit,published_at,tags,moderation_state')
    .eq('status', 'published').eq('moderation_state', 'clear')
    .order('published_at', { ascending: false }).limit(80)
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
  const signed = await Promise.all(clips.map(async (clip) => {
    let playbackUrl = clip.video_provider === 'google_drive'
      ? null
      : (clip.playback_url || null)
    if (clip.video_provider === 'google_drive' && clip.video_asset_id) {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData?.session?.access_token
      if (!token) return null
      playbackUrl = `/api/waves-video?id=${encodeURIComponent(clip.id)}&token=${encodeURIComponent(token)}`
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
