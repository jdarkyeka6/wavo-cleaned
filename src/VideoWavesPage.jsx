import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import { ArrowLeft, Bookmark, Flag, Heart, LogOut, MessageCircle, Plus, Send, Share2, SlidersHorizontal, Volume2, VolumeX, X } from 'lucide-react'
import { supabase } from './supabaseClient'
import { createPost, deletePost, getFriends, getPosts, reactToPost, sendDmMessage } from './wavoData'
import './video-waves.css'
import { CURATED_CHANNELS, channelBySlug, loadCuratedWaves, postKey } from './wavesCuratedData'
import { rankWavesFeed } from './wavesRecommendations'
import { useWavesWatchSignals } from './wavesWatchSignals'
import WavesCuratedManager from './WavesCuratedManager'

const VIDEO_LIMIT_BYTES = 50 * 1024 * 1024
const VIDEO_LIMIT_MS = 60_000
const PAGE_SIZE = 50

function initial(name) {
  return (name?.trim()?.[0] || 'W').toUpperCase()
}

function Avatar({ profile }) {
  return <span className="video-wave-avatar">
    {profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : initial(profile?.username)}
  </span>
}

function relativeTime(value) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return String(minutes) + 'm'
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return String(hours) + 'h'
  return String(Math.floor(hours / 24)) + 'd'
}

function count(value) {
  if (value < 1000) return String(value)
  if (value < 1_000_000) return (value / 1000).toFixed(value < 10000 ? 1 : 0) + 'K'
  return (value / 1_000_000).toFixed(1) + 'M'
}

function waveUrl(id, curated = false) {
  const standalone = ['wavowaves.lol', 'www.wavowaves.lol'].includes(window.location.hostname)
  return window.location.origin + (standalone ? '/?wave=' : '/waves/video?wave=') + encodeURIComponent((curated ? 'curated:' : '') + id)
}

async function signMedia(path) {
  if (!path) return null
  const { data, error } = await supabase.storage.from('wave-media').createSignedUrl(path, 15 * 60)
  if (error) throw error
  return data?.signedUrl || null
}

async function loadVideoWaves(userId) {
  // Reuse Wavo's existing friends/selected-recipient RLS and media access.
  // No public discovery or assumption that private posts may be redistributed.
  const friends = await getFriends(userId)
  const posts = (await getPosts(userId, friends))
    .filter((post) => post.media_type === 'video' && post.media_path && post.visibility !== 'group')
    .slice(0, PAGE_SIZE)

  const signed = await Promise.all(posts.map(async (post) => {
    try {
      return { ...post, kind: 'friend', media_url_signed: await signMedia(post.media_path) }
    } catch {
      return null
    }
  }))
  return signed.filter((post) => post?.media_url_signed)
}

function getVideoDuration(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    const finish = (duration, error) => {
      URL.revokeObjectURL(url)
      video.removeAttribute('src')
      video.load()
      if (error) reject(error)
      else resolve(duration)
    }
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      const duration = video.duration * 1000
      if (!Number.isFinite(duration) || duration <= 0) finish(null, new Error('Could not read the video duration.'))
      else finish(duration)
    }
    video.onerror = () => finish(null, new Error('Could not read this video.'))
    video.src = url
  })
}

function Login({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const email = username.includes('@') ? username.trim().toLowerCase() : username.trim().toLowerCase() + '@wavo.app'
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password })
      if (authError) throw authError
      onLogin(data.session)
    } catch {
      setError('Could not sign in. Check your username and password.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="video-waves-auth">
    <a className="video-waves-back-link" href="https://wavo.lol/"><ArrowLeft size={18} /> Wavo</a>
    <div className="video-waves-auth-card">
      <div className="video-waves-mark">W<span>~</span></div>
      <span className="video-waves-eyebrow">YOUR PEOPLE. YOUR WAVES.</span>
      <h1>Every moment<br />makes a wave.</h1>
      <p>Sign in with your existing Wavo account to see videos shared with you.</p>
      <form onSubmit={submit}>
        <label>Wavo username or email<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required autoCapitalize="none" spellCheck={false} /></label>
        <label>Password<input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        {error && <p className="video-waves-form-error" role="alert">{error}</p>}
        <button className="video-waves-primary" disabled={busy}>{busy ? 'Signing in…' : 'Enter Waves'}</button>
      </form>
      <small>Waves is part of Wavo. Accounts and sharing permissions stay with Wavo.</small>
    </div>
  </main>
}

function Upload({ userId, onClose, onCreated }) {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState('')
  const [caption, setCaption] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!file) {
      setPreview('')
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  async function publish(event) {
    event.preventDefault()
    if (!file || busy) return
    setError('')
    setBusy(true)
    let post
    let path
    try {
      if (!['video/mp4', 'video/quicktime'].includes(file.type)) throw new Error('Upload an MP4 or MOV video.')
      if (file.size > VIDEO_LIMIT_BYTES) throw new Error('Videos must be 50 MB or smaller.')
      const duration = await getVideoDuration(file)
      if (duration > VIDEO_LIMIT_MS) throw new Error('Videos must be 60 seconds or shorter.')
      const extension = file.type === 'video/quicktime' ? 'mov' : 'mp4'
      post = await createPost(userId, { body: caption.trim(), visibility: 'friends' })
      path = userId + '/' + post.id + '/' + crypto.randomUUID() + '.' + extension
      const { error: uploadError } = await supabase.storage.from('wave-media').upload(path, file, {
        contentType: file.type,
        cacheControl: '3600',
        upsert: false,
      })
      if (uploadError) throw uploadError
      const { error: updateError } = await supabase.from('posts').update({
        media_path: path,
        media_type: 'video',
        media_filename: file.name.slice(0, 180),
        media_size_bytes: file.size,
        video_duration_ms: Math.round(duration),
      }).eq('id', post.id).eq('author_id', userId)
      if (updateError) throw updateError
      await onCreated()
      onClose()
    } catch (uploadError) {
      if (path) await supabase.storage.from('wave-media').remove([path]).catch(() => {})
      if (post?.id) await deletePost(userId, post.id).catch(() => {})
      setError(uploadError?.message || 'Could not upload this Wave.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="video-wave-modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <form className="video-wave-upload" onSubmit={publish}>
      <div className="video-wave-sheet-title"><strong>New video Wave</strong><button type="button" onClick={onClose} disabled={busy} aria-label="Close"><X /></button></div>
      {preview ? <video className="video-wave-upload-preview" src={preview} playsInline controls /> : <label className="video-wave-upload-picker"><Plus size={28} /> Choose a video<input type="file" accept="video/mp4,video/quicktime,.mp4,.mov" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>}
      {preview && <label className="video-wave-change-file">Choose another<input type="file" accept="video/mp4,video/quicktime,.mp4,.mov" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>}
      <textarea aria-label="Caption" maxLength={1200} placeholder="Write a caption…" value={caption} onChange={(event) => setCaption(event.target.value)} />
      <p className="video-wave-privacy">Shared with your Wavo friends only. Up to 60 seconds / 50 MB.</p>
      {error && <p className="video-waves-form-error" role="alert">{error}</p>}
      <button className="video-waves-primary" type="submit" disabled={!file || busy}>{busy ? 'Publishing…' : 'Publish Wave'}</button>
    </form>
  </div>
}

function VideoCard({ post, userId, active, muted, setMuted, onLike, onShare, onReply, saved, onSave, onSignal, onReport }) {
  const videoRef = useRef(null)
  const watch = useWavesWatchSignals(videoRef, post, active, onSignal)
  const [playing, setPlaying] = useState(false)
  const curated = post.kind === 'curated'
  const channel = curated ? channelBySlug[post.channel_slug] : null
  const mine = !curated && post.author_id === userId
  const myReaction = (post.reactions || []).find((reaction) => reaction.user_id === userId)
  const liked = myReaction?.emoji === '❤️'

  useEffect(() => {
    const video = videoRef.current
    if (!video || !post.media_hls_url) return
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = post.media_hls_url
      return
    }
    if (!Hls.isSupported()) return
    const hls = new Hls({
      maxBufferLength: 12,
      maxMaxBufferLength: 24,
      startLevel: -1,
      capLevelToPlayerSize: true,
    })
    hls.loadSource(post.media_hls_url)
    hls.attachMedia(video)
    return () => hls.destroy()
  }, [post.media_hls_url])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (active && !document.hidden) {
      video.play().catch(() => setPlaying(false))
    } else {
      video.pause()
    }
  }, [active])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = muted
  }, [muted])

  useEffect(() => {
    function visibilityChanged() {
      const video = videoRef.current
      if (!video) return
      if (document.hidden) video.pause()
      else if (active) video.play().catch(() => setPlaying(false))
    }
    document.addEventListener('visibilitychange', visibilityChanged)
    return () => document.removeEventListener('visibilitychange', visibilityChanged)
  }, [active])

  function togglePlay() {
    const video = videoRef.current
    if (!video) return
    if (video.paused) video.play().catch(() => setPlaying(false))
    else video.pause()
  }

  async function share() {
    const url = waveUrl(post.id, curated)
    try {
      if (navigator.share) await navigator.share({ title: 'Wave by @' + (post.author?.username || 'wavo'), url })
      else {
        await navigator.clipboard.writeText(url)
        onShare(curated ? 'Waves link copied' : 'Private link copied. Only the selected audience can view this Wave.')
      }
    } catch (error) {
      if (error?.name !== 'AbortError') onShare('Could not share this Wave.')
    }
  }

  return <article className="video-wave-card">
    <video ref={videoRef} className="video-wave-player" src={post.media_hls_url ? undefined : post.media_url_signed} preload={active ? 'auto' : 'metadata'} playsInline loop muted={muted}
      onClick={togglePlay} onPlay={() => { setPlaying(true); watch.onPlay() }} onTimeUpdate={watch.onTimeUpdate} onPause={() => setPlaying(false)} aria-label={post.body || 'Wave video'} />
    <div className="video-wave-scrim" />
    {!playing && <button className="video-wave-play" onClick={togglePlay} aria-label="Play video"><Play size={34} fill="currentColor" /></button>}
    <button className="video-wave-sound" onClick={() => setMuted((value) => !value)} aria-label={muted ? 'Unmute' : 'Mute'}>
      {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
    </button>
    <div className="video-wave-meta">
      <div className="video-wave-author">{curated ? <span className="video-wave-channel-avatar" aria-hidden="true">{channel?.emoji || '🌊'}</span> : <Avatar profile={post.author} />}<strong>@{post.author?.username || 'wavo'}</strong><span>· {relativeTime(post.created_at)}</span></div>
      {post.body && <p>{post.body}</p>}
      <span className="video-wave-audio">{curated ? 'Wavo-curated collection · ' + (channel?.name || 'Waves') : '♫ Original Wave audio · Friends only'}</span>{curated && post.source_credit && <span className="video-wave-source">Source: {post.source_credit}</span>}
    </div>
    <aside className="video-wave-actions">
      <button className={liked ? 'active' : ''} onClick={() => onLike(post)} aria-label={liked ? 'Remove reaction' : 'Like'}>
        <Heart size={28} fill={liked ? 'currentColor' : 'none'} /><span>{count((post.reactions || []).length)}</span>
      </button>
      {!mine && !curated && <button onClick={() => onReply(post)} aria-label="Reply to creator"><MessageCircle size={28} /><span>Reply</span></button>}
      <button onClick={share} aria-label="Share"><Share2 size={28} /><span>Share</span></button>
      {curated && <button onClick={() => onReport(post)} aria-label="Report video"><Flag size={26} /><span>Report</span></button>}
      <button className={saved ? 'active' : ''} onClick={() => onSave(post.id)} aria-label={saved ? 'Remove from saved videos' : 'Save on this device'}>
        <Bookmark size={28} fill={saved ? 'currentColor' : 'none'} /><span>Save</span>
      </button>
    </aside>
  </article>
}

function Reply({ post, userId, onClose, onSent }) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    if (!message.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const context = post.body ? post.body.slice(0, 90) : 'Video Wave'
      await sendDmMessage(userId, post.author_id, '↪ Replied to Wave: ' + context + '\n' + message.trim())
      onSent()
    } catch {
      setError('Could not send that reply.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="video-wave-modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <form className="video-wave-reply" onSubmit={submit}>
      <div className="video-wave-sheet-title"><strong>Reply to @{post.author?.username || 'creator'}</strong><button type="button" onClick={onClose} aria-label="Close"><X /></button></div>
      <p>Your reply is sent as a private Wavo message, not a public comment.</p>
      <textarea required autoFocus maxLength={1200} placeholder="Write your reply…" value={message} onChange={(event) => setMessage(event.target.value)} />
      {error && <p className="video-waves-form-error" role="alert">{error}</p>}
      <button className="video-waves-primary" disabled={!message.trim() || busy}><Send size={16} /> {busy ? 'Sending…' : 'Send reply'}</button>
    </form>
  </div>
}

export default function VideoWavesPage() {
  const [session, setSession] = useState(null)
  const [booting, setBooting] = useState(true)
  const [posts, setPosts] = useState([])
  const [channel, setChannel] = useState('all')
  const [isAdmin, setIsAdmin] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [draftCount, setDraftCount] = useState(0)
  const [activeId, setActiveId] = useState(null)
  const [muted, setMuted] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [replyPost, setReplyPost] = useState(null)
  const [reportPost, setReportPost] = useState(null)
  const [savedIds, setSavedIds] = useState([])
  const userId = session?.user?.id
  const feedRef = useRef(null)
  const shownPosts = posts.filter((post) => channel === 'all' || (channel === 'friends' ? post.kind === 'friend' : post.kind === 'curated' && post.channel_slug === channel))

  useEffect(() => {
    document.title = 'Waves | Wavo'
    let alive = true
    supabase.auth.getSession()
      .then(({ data }) => { if (alive) setSession(data.session || null) })
      .catch(() => { if (alive) setError('Could not check your Wavo session.') })
      .finally(() => { if (alive) setBooting(false) })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      if (alive) { setSession(next); setBooting(false) }
    })
    return () => { alive = false; data.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (!userId) { setPosts([]); setLoading(false); setIsAdmin(false); return }
    let active = true
    supabase.from('profiles').select('is_admin').eq('id', userId).single()
      .then(async ({ data }) => {
        if (!active) return
        const admin = data?.is_admin === true
        setIsAdmin(admin)
        if (admin) {
          const { count, error: draftError } = await supabase.from('waves_curated_clips')
            .select('id', { count: 'exact', head: true }).eq('status', 'draft')
          if (active && !draftError) setDraftCount(count || 0)
        }
      })
      .catch(() => { if (active) setIsAdmin(false) })
    return () => { active = false }
  }, [userId])

  useEffect(() => {
    if (!userId) return
    try {
      const stored = JSON.parse(localStorage.getItem('wavo-video-saved:' + userId) || '[]')
      setSavedIds(Array.isArray(stored) ? stored : [])
    } catch { setSavedIds([]) }
  }, [userId])

  function recordSignal(post, delta = {}) {
    if (!userId) return
    supabase.rpc('record_waves_video_signal', {
      p_video_key: postKey(post),
      p_channel_slug: post.kind === 'curated' ? post.channel_slug : null,
      p_watched_ms: delta.watchedMs || 0,
      p_plays: delta.plays || 0,
      p_completions: delta.completions || 0,
      p_skips: delta.skips || 0,
      p_rewatches: delta.rewatches || 0,
      p_liked: delta.liked ?? null,
      p_saved: delta.saved ?? null,
    }).then(({ error: signalError }) => {
      if (signalError) console.warn('[waves] learning unavailable', signalError.message)
    }).catch((signalError) => console.warn('[waves] learning unavailable', signalError))
  }

  function chooseChannel(slug) {
    if (slug !== 'all' && slug !== 'friends' && slug !== channel) {
      supabase.rpc('record_waves_channel_choice', { p_channel_slug: slug })
        .then(({ error: choiceError }) => {
          if (choiceError) console.warn('[waves] channel preference unavailable', choiceError.message)
        }).catch((choiceError) => console.warn('[waves] channel preference unavailable', choiceError))
    }
    setChannel(slug)
    // Re-ranking on return avoids rearranging a video while it is playing.
    if (slug === 'all' && channel !== 'all') void refresh()
  }

  async function refresh() {
    if (!userId) return
    setLoading(true)
    setError('')
    try {
      const [friendsResult, curatedResult] = await Promise.allSettled([loadVideoWaves(userId), loadCuratedWaves()])
      if (friendsResult.status === 'rejected' && curatedResult.status === 'rejected') throw friendsResult.reason
      if (friendsResult.status === 'rejected') console.warn('[waves] friend feed unavailable', friendsResult.reason)
      if (curatedResult.status === 'rejected') console.warn('[waves] curated feed unavailable', curatedResult.reason)
      const friends = friendsResult.status === 'fulfilled' ? friendsResult.value : []
      const curated = curatedResult.status === 'fulfilled' ? curatedResult.value : []
      const [signalsResult, choicesResult] = await Promise.all([
        supabase.from('waves_video_signals')
          .select('video_key,channel_slug,tags,watched_ms,plays,completions,skips,rewatches,liked,saved,updated_at')
          .eq('user_id', userId).order('updated_at', { ascending: false }).limit(1000),
        supabase.from('waves_channel_choices').select('channel_slug,visits').eq('user_id', userId),
      ])
      if (signalsResult.error) console.warn('[waves] preferences unavailable', signalsResult.error.message)
      if (choicesResult.error) console.warn('[waves] channel choices unavailable', choicesResult.error.message)
      const rows = rankWavesFeed(friends, curated, signalsResult.data || [], choicesResult.data || [], savedIds)
      setPosts(rows)
      const requested = new URLSearchParams(window.location.search).get('wave')
      const selected = rows.find((row) => (row.kind === 'curated' ? 'curated:' : '') + row.id === requested)
      setActiveId(selected ? postKey(selected) : rows[0] ? postKey(rows[0]) : null)
      if (selected) requestAnimationFrame(() => {
        const cards = feedRef.current?.querySelectorAll('[data-video-wave-id]') || []
        const card = [...cards].find((element) => element.dataset.videoWaveId === postKey(selected))
        card?.scrollIntoView({ block: 'start' })
      })
    } catch (loadError) {
      console.error('[wavo] video waves', loadError)
      setError('Could not load your video Waves. Try again.')
    } finally { setLoading(false) }
  }

  useEffect(() => { if (userId) refresh() }, [userId])

  useEffect(() => {
    setActiveId(shownPosts[0] ? postKey(shownPosts[0]) : null)
    if (feedRef.current) feedRef.current.scrollTop = 0
  }, [channel])

  useEffect(() => {
    if (!shownPosts.length || !feedRef.current) return
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
      if (visible?.target?.dataset?.videoWaveId) setActiveId(visible.target.dataset.videoWaveId)
    }, { root: feedRef.current, threshold: [0.55, 0.8] })
    feedRef.current.querySelectorAll('[data-video-wave-id]').forEach((card) => observer.observe(card))
    return () => observer.disconnect()
  }, [posts, channel])

  async function like(post) {
    if (post.kind === 'curated') {
      const mine = (post.reactions || []).some((reaction) => reaction.user_id === userId)
      const action = mine
        ? supabase.from('waves_curated_likes').delete().eq('clip_id', post.id).eq('user_id', userId)
        : supabase.from('waves_curated_likes').insert({ clip_id: post.id, user_id: userId })
      const { error: likeError } = await action
      if (likeError) { setToast('Could not update your like.'); return }
      setPosts((current) => current.map((item) => item.kind === 'curated' && item.id === post.id ? { ...item,
        reactions: mine ? item.reactions.filter((reaction) => reaction.user_id !== userId) : [...item.reactions, { user_id: userId }],
      } : item))
      recordSignal(post, { liked: !mine })
      return
    }
    const removing = (post.reactions || []).some((reaction) => reaction.user_id === userId && reaction.emoji === '❤️')
    try {
      await reactToPost(userId, post.id, '❤️')
      setPosts((current) => current.map((item) => item.id === post.id ? {
        ...item,
        reactions: removing
          ? (item.reactions || []).filter((reaction) => reaction.user_id !== userId)
          : [...(item.reactions || []).filter((reaction) => reaction.user_id !== userId), { user_id: userId, emoji: '❤️' }],
      } : item))
      recordSignal(post, { liked: !removing })
    } catch { setToast('Could not update your reaction.') }
  }

  function toggleSaved(post) {
    const id = postKey(post)
    const nowSaved = !savedIds.includes(id)
    const next = nowSaved ? [...savedIds, id] : savedIds.filter((saved) => saved !== id)
    setSavedIds(next)
    try { localStorage.setItem('wavo-video-saved:' + userId, JSON.stringify(next)) } catch { /* optional local feature */ }
    recordSignal(post, { saved: nowSaved })
    setToast(nowSaved ? 'Saved on this device' : 'Removed from saved videos')
  }

  async function reportVideo(post, reason) {
    const { error: reportError } = await supabase.from('waves_video_reports').insert({
      clip_id: post.id, reporter_id: userId, reason, status: 'open',
    })
    if (reportError) { setToast('Could not send report.'); return }
    setReportPost(null)
    setToast('Report sent for review')
  }

  if (booting) return <div className="video-waves-loading">Loading Wavo Waves…</div>
  if (!userId) return <Login onLogin={setSession} />
  if (manageOpen && isAdmin) return <WavesCuratedManager userId={userId} onClose={() => setManageOpen(false)} onChanged={refresh} />

  return <main className="video-waves-shell">
    <header className="video-waves-topbar">
      <a href="https://wavo.lol/" aria-label="Back to Wavo"><ArrowLeft size={20} /></a>
      <strong>Waves<span className="video-waves-brand-dot">.</span></strong>
      <span>{channel === 'all' ? 'For You' : channel === 'friends' ? 'Friends' : channelBySlug[channel]?.name || 'Channels'}</span>
      <div className="video-waves-top-actions">
        {isAdmin && <button onClick={() => setManageOpen(true)} aria-label="Open Waves Studio"><SlidersHorizontal size={18} /> <span>Studio</span></button>}
        <button onClick={() => setUploadOpen(true)} aria-label="Post a video"><Plus size={20} /> <span>Post</span></button>
        <button onClick={() => supabase.auth.signOut()} aria-label="Sign out"><LogOut size={18} /></button>
      </div>
    </header>
    <nav className="video-waves-channels" aria-label="Waves channels"><button className={channel === 'all' ? 'chosen' : ''} onClick={() => chooseChannel('all')}>✨ For You</button><button className={channel === 'friends' ? 'chosen' : ''} onClick={() => chooseChannel('friends')}>👥 Friends</button>{CURATED_CHANNELS.map((entry) => <button key={entry.slug} className={channel === entry.slug ? 'chosen' : ''} onClick={() => chooseChannel(entry.slug)}>{entry.emoji} {entry.name}</button>)}</nav>
    {loading && <div className="video-waves-loading">Loading video Waves…</div>}
    {error && <div className="video-waves-error" role="alert">{error}<button onClick={refresh}>Retry</button></div>}
    {!loading && !error && !shownPosts.length && <div className="video-waves-empty">
      {isAdmin && channel !== 'friends' ? <>
        <strong>{draftCount ? `${draftCount} clips are waiting in Studio` : 'Your curated feed is waiting for its first clip.'}</strong>
        <span>Channels are ready. Videos in the private review queue are not visible here until their source rights, audio, edits and content are checked and they are published.</span>
        <button className="video-waves-primary" onClick={() => setManageOpen(true)}>Review clips in Studio</button>
        <button className="video-waves-secondary" onClick={() => setUploadOpen(true)}>Or post your own video</button>
      </> : <>
        <strong>{channel === 'all' ? 'No video Waves yet.' : 'Nothing in this channel yet.'}</strong>
        <span>{channel === 'all' ? 'Your friends and approved curated videos will appear here.' : 'Try For You or another channel while we add more clips.'}</span>
        <button className="video-waves-primary" onClick={() => setUploadOpen(true)}>Post a video</button>
      </>}
    </div>}
    <section className="video-waves-feed" ref={feedRef} aria-label="Video Waves">
      {shownPosts.map((post) => <div key={postKey(post)} data-video-wave-id={postKey(post)} className="video-wave-snap">
        <VideoCard post={post} userId={userId} active={activeId === postKey(post)} muted={muted} setMuted={setMuted}
          onLike={like} onShare={setToast} onReply={setReplyPost}
          saved={savedIds.includes(postKey(post))} onSave={() => toggleSaved(post)} onSignal={recordSignal} onReport={setReportPost} />
      </div>)}
    </section>
    {uploadOpen && <Upload userId={userId} onClose={() => setUploadOpen(false)} onCreated={refresh} />}
    {reportPost && <div className="video-wave-modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setReportPost(null) }}>
      <div className="video-wave-reply">
        <div className="video-wave-sheet-title"><strong>Report this video</strong><button type="button" onClick={() => setReportPost(null)} aria-label="Close"><X /></button></div>
        <p>Choose the closest reason. The video stays up unless moderation takes action.</p>
        {['unsafe','sexual','violence','hate','harassment','privacy','spam','copyright','other'].map((reason) =>
          <button className="video-waves-secondary" type="button" key={reason} onClick={() => reportVideo(reportPost, reason)}>{reason[0].toUpperCase() + reason.slice(1)}</button>)}
      </div>
    </div>}
    {replyPost && <Reply post={replyPost} userId={userId} onClose={() => setReplyPost(null)}
      onSent={() => { setReplyPost(null); setToast('Reply sent in Wavo messages') }} />}
    {toast && <button className="video-wave-toast" onClick={() => setToast('')} role="status">{toast}</button>}
  </main>
}
