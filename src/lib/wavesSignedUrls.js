// Batch private Waves media signing to avoid one network request per video.
// Storage RLS still determines which already-visible posts the viewer may access.
export async function signVideoWavesPosts(bucket, posts, expiresIn = 15 * 60) {
  const candidates = (Array.isArray(posts) ? posts : [])
    .filter((post) => typeof post?.media_path === 'string' && post.media_path.length > 0)
  if (!candidates.length) return []

  const paths = [...new Set(candidates.map((post) => post.media_path))]
  const urls = new Map()

  try {
    const { data, error } = await bucket.createSignedUrls(paths, expiresIn)
    if (error || !Array.isArray(data)) throw error || new Error('No signed URLs returned')
    const requestedPaths = new Set(paths)
    for (let i = 0; i < data.length; i += 1) {
      const entry = data[i]
      const path = entry?.path ?? paths[i]
      if (requestedPaths.has(path) && !entry?.error && typeof entry?.signedUrl === 'string' && entry.signedUrl) {
        urls.set(path, entry.signedUrl)
      }
    }
  } catch {
    // Older clients or transient batch failures still support the original
    // per-object flow, without making any inaccessible media public.
    await Promise.all(paths.map(async (path) => {
      try {
        const { data, error } = await bucket.createSignedUrl(path, expiresIn)
        if (!error && data?.signedUrl) urls.set(path, data.signedUrl)
      } catch {
        // A failed item must not block other videos in the feed.
      }
    }))
  }

  return candidates
    .map((post) => ({ ...post, kind: 'friend', media_url_signed: urls.get(post.media_path) || null }))
    .filter((post) => post.media_url_signed)
}
