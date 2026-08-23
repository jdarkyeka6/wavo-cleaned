import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Check,
  Image as ImageIcon,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Send,
  Trash2,
  Users,
  Video,
  X,
} from 'lucide-react'
import { supabase } from './supabaseClient'
import {
  createPost,
  deletePost,
  getFriends,
  getPosts,
  reactToPost,
  sendDmMessage,
} from './wavoData'
import './waves-page.css'

const IMAGE_LIMIT = 10 * 1024 * 1024
const VIDEO_LIMIT = 50 * 1024 * 1024
const VIDEO_MAX_MS = 60_000
const PAGE_SIZE = 30

function relativeTime(value) {
  const diff = Date.now() - new Date(value).getTime()
  const minutes = Math.max(0, Math.floor(diff / 60_000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function initial(name) {
  return (name?.trim()?.[0] || 'W').toUpperCase()
}

function Avatar({ profile }) {
  return (
    <div className="waves-avatar">
      {profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : initial(profile?.username)}
    </div>
  )
}

function videoDuration(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      resolve(Math.round(video.duration * 1000))
    }
    video.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('That video could not be read.'))
    }
    video.src = url
  })
}

function safeExtension(file) {
  const byMime = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
  }
  return byMime[file.type] || file.name.split('.').pop()?.toLowerCase() || 'bin'
}

async function signedMediaUrl(path) {
  if (!path) return null
  const { data, error } = await supabase.storage.from('wave-media').createSignedUrl(path, 15 * 60)
  if (error) return null
  return data?.signedUrl || null
}

function PresetControls({ userId, friends, selected, setSelected }) {
  const [presets, setPresets] = useState([])
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)

  async function load() {
    const { data } = await supabase
      .from('audience_presets')
      .select('id,name,member_usernames,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
    setPresets(data || [])
  }

  useEffect(() => { load() }, [userId])

  function apply(preset) {
    const names = new Set((preset.member_usernames || []).map((value) => value.toLowerCase()))
    setSelected(friends.filter((friend) => names.has(friend.username?.toLowerCase())).map((friend) => friend.id))
  }

  async function save(e) {
    e.preventDefault()
    const clean = name.trim()
    if (!clean || !selected.length) return
    const usernames = friends.filter((friend) => selected.includes(friend.id)).map((friend) => friend.username).filter(Boolean)
    const { error } = await supabase.from('audience_presets').insert({
      user_id: userId,
      name: clean,
      member_usernames: usernames,
    })
    if (!error) {
      setName('')
      setCreating(false)
      load()
    }
  }

  async function remove(id) {
    await supabase.from('audience_presets').delete().eq('id', id).eq('user_id', userId)
    load()
  }

  return (
    <div className="waves-presets">
      <div className="waves-presets-head">
        <span><Users size={14} /> Presets</span>
        <button type="button" onClick={() => setCreating((value) => !value)}><Plus size={14} /> Add preset</button>
      </div>
      {presets.length > 0 && (
        <div className="waves-preset-list">
          {presets.map((preset) => (
            <span key={preset.id} className="waves-preset-chip">
              <button type="button" onClick={() => apply(preset)}>{preset.name}</button>
              <button type="button" aria-label={`Delete ${preset.name}`} onClick={() => remove(preset.id)}><Trash2 size={12} /></button>
            </span>
          ))}
        </div>
      )}
      {!presets.length && !creating && <small>Save groups like Family, Close Friends or School.</small>}
      {creating && (
        <form onSubmit={save} className="waves-preset-create">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} placeholder="Family" autoFocus />
          <button type="submit" disabled={!name.trim() || !selected.length}><Check size={14} /> Save selected</button>
        </form>
      )}
    </div>
  )
}

function Composer({ open, onClose, userId, friends, onCreated }) {
  const [caption, setCaption] = useState('')
  const [visibility, setVisibility] = useState('friends')
  const [selected, setSelected] = useState([])
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef(null)

  useEffect(() => {
    if (!file) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  useEffect(() => {
    if (!open) {
      setCaption('')
      setVisibility('friends')
      setSelected([])
      setFile(null)
      setError('')
    }
  }, [open])

  if (!open) return null

  async function pick(nextFile) {
    setError('')
    if (!nextFile) return
    const image = nextFile.type.startsWith('image/')
    const video = nextFile.type.startsWith('video/')
    if (!image && !video) return setError('Choose a photo or video.')
    if (image && nextFile.size > IMAGE_LIMIT) return setError('Photos can be up to 10 MB.')
    if (video && nextFile.size > VIDEO_LIMIT) return setError('Videos can be up to 50 MB.')
    if (video) {
      try {
        const duration = await videoDuration(nextFile)
        if (duration > VIDEO_MAX_MS) return setError('Videos can be up to 60 seconds.')
      } catch (err) {
        return setError(err.message)
      }
    }
    setFile(nextFile)
  }

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (!caption.trim() && !file) return setError('Add a caption, photo or video.')
    if (visibility === 'selected' && selected.length === 0) return setError('Choose at least one person.')
    setBusy(true)
    let post = null
    let uploadedPath = null
    try {
      post = await createPost(userId, {
        body: caption.trim(),
        visibility,
        recipientIds: visibility === 'selected' ? selected : [],
      })

      if (file) {
        const mediaType = file.type.startsWith('video/') ? 'video' : 'image'
        const duration = mediaType === 'video' ? await videoDuration(file) : null
        const random = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
        uploadedPath = `${userId}/${post.id}/${random}.${safeExtension(file)}`
        const { error: uploadError } = await supabase.storage.from('wave-media').upload(uploadedPath, file, {
          contentType: file.type,
          cacheControl: '3600',
          upsert: false,
        })
        if (uploadError) throw uploadError

        const { error: updateError } = await supabase.from('posts').update({
          media_path: uploadedPath,
          media_type: mediaType,
          media_filename: file.name.slice(0, 180),
          media_size_bytes: file.size,
          video_duration_ms: duration,
        }).eq('id', post.id).eq('author_id', userId)
        if (updateError) throw updateError
      }

      await onCreated()
      onClose()
    } catch (err) {
      console.error('[wavo] create wave', err)
      if (uploadedPath) await supabase.storage.from('wave-media').remove([uploadedPath]).catch(() => {})
      if (post?.id) await deletePost(userId, post.id).catch(() => {})
      setError('Could not share that Wave. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="waves-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="waves-composer" onSubmit={submit}>
        <header>
          <div><span>NEW WAVE</span><h2>Share with your people</h2></div>
          <button type="button" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </header>

        {preview && (
          <div className="waves-preview">
            {file?.type.startsWith('video/') ? <video src={preview} controls preload="metadata" /> : <img src={preview} alt="Preview" />}
            <button type="button" onClick={() => setFile(null)} aria-label="Remove media"><X size={16} /></button>
          </div>
        )}

        <textarea value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={1200} placeholder="What do you want to share?" />

        <div className="waves-media-buttons">
          <button type="button" onClick={() => fileRef.current?.click()}><ImageIcon size={17} /> Photo or video</button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime" hidden onChange={(e) => pick(e.target.files?.[0] || null)} />
          {file && <span>{file.type.startsWith('video/') ? <Video size={14} /> : <ImageIcon size={14} />} {file.name}</span>}
        </div>

        <label className="waves-field">
          <span>Share with</span>
          <select value={visibility} onChange={(e) => setVisibility(e.target.value)}>
            <option value="friends">All friends</option>
            <option value="selected">Choose people</option>
          </select>
        </label>

        {visibility === 'selected' && (
          <div className="waves-audience">
            <PresetControls userId={userId} friends={friends} selected={selected} setSelected={setSelected} />
            <div className="waves-friend-picker">
              {friends.map((friend) => {
                const chosen = selected.includes(friend.id)
                return (
                  <button key={friend.id} type="button" className={chosen ? 'chosen' : ''} onClick={() => setSelected((current) => chosen ? current.filter((id) => id !== friend.id) : [...current, friend.id])}>
                    <Avatar profile={friend} />
                    <span>{friend.username}</span>
                    <i>{chosen && <Check size={15} />}</i>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {error && <div className="waves-error">{error}</div>}
        <footer>
          <span>{visibility === 'friends' ? 'Only people you have added can see this.' : `${selected.length} selected`}</span>
          <button type="submit" disabled={busy}>{busy ? 'Sharing…' : 'Share Wave'}</button>
        </footer>
      </form>
    </div>
  )
}

function ReplyBox({ post, userId, onClose }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  if (!post) return null

  async function submit(e) {
    e.preventDefault()
    const clean = text.trim()
    if (!clean || busy) return
    setBusy(true)
    try {
      const prefix = post.body ? `↪ ${post.body.slice(0, 90)}${post.body.length > 90 ? '…' : ''}\n` : '↪ Replied to your Wave\n'
      await sendDmMessage(userId, post.author_id, `${prefix}${clean}`)
      onClose('Reply sent')
    } catch {
      setBusy(false)
    }
  }

  return (
    <div className="waves-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="waves-reply" onSubmit={submit}>
        <header><strong>Reply to {post.author?.username}</strong><button type="button" onClick={() => onClose()}><X size={18} /></button></header>
        <div className="waves-reply-context">{post.body || (post.media_type === 'video' ? 'Video Wave' : 'Photo Wave')}</div>
        <div className="waves-reply-row"><input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply in a message…" /><button disabled={busy || !text.trim()}><Send size={17} /></button></div>
      </form>
    </div>
  )
}

function WaveCard({ post, userId, onReply, onDelete, onReact }) {
  const mine = post.author_id === userId
  const myReaction = (post.reactions || []).find((reaction) => reaction.user_id === userId)?.emoji

  return (
    <article className="waves-card">
      <header>
        <Avatar profile={post.author} />
        <div><strong>{post.author?.username || 'Wavo user'}</strong><span>{relativeTime(post.created_at)} · {post.visibility === 'selected' ? 'Selected people' : 'Friends'}</span></div>
        {mine ? <button onClick={() => onDelete(post)} aria-label="Delete Wave"><Trash2 size={16} /></button> : <button aria-label="More"><MoreHorizontal size={18} /></button>}
      </header>

      {post.media_url_signed && (
        <div className="waves-card-media">
          {post.media_type === 'video' ? <video src={post.media_url_signed} controls preload="metadata" playsInline /> : <img src={post.media_url_signed} alt="Shared Wave" />}
        </div>
      )}

      {post.body && <p>{post.body}</p>}

      <footer>
        {!mine && <button className="waves-reply-button" onClick={() => onReply(post)}><MessageCircle size={16} /> Reply</button>}
        <div className="waves-reactions" aria-label="React to Wave">
          {['❤️', '😂', '🔥', '👀'].map((emoji) => <button key={emoji} className={myReaction === emoji ? 'selected' : ''} onClick={() => onReact(post.id, emoji)}>{emoji}</button>)}
        </div>
      </footer>
    </article>
  )
}

export default function WavesPage() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [friends, setFriends] = useState([])
  const [posts, setPosts] = useState([])
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [composerOpen, setComposerOpen] = useState(false)
  const [replyPost, setReplyPost] = useState(null)
  const [toast, setToast] = useState('')

  const userId = session?.user?.id

  useEffect(() => {
    let live = true
    supabase.auth.getSession().then(({ data }) => {
      if (!live) return
      setSession(data.session || null)
      setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setLoading(false)
    })
    return () => {
      live = false
      data.subscription.unsubscribe()
    }
  }, [])

  async function refresh() {
    if (!userId) return
    const nextFriends = await getFriends(userId)
    const nextPosts = await getPosts(userId, nextFriends)
    const enriched = await Promise.all(nextPosts.map(async (post) => ({
      ...post,
      media_url_signed: post.media_path ? await signedMediaUrl(post.media_path) : null,
    })))
    setFriends(nextFriends)
    setPosts(enriched)
  }

  useEffect(() => {
    if (!userId) return
    refresh().catch((err) => {
      console.error('[wavo] load Waves', err)
      setToast('Could not load Waves.')
    })
  }, [userId])

  const visiblePosts = useMemo(() => posts.slice(0, visibleCount), [posts, visibleCount])

  async function remove(post) {
    try {
      if (post.media_path) await supabase.storage.from('wave-media').remove([post.media_path])
      await deletePost(userId, post.id)
      await refresh()
      setToast('Wave deleted')
    } catch {
      setToast('Could not delete that Wave.')
    }
  }

  async function react(postId, emoji) {
    try {
      await reactToPost(userId, postId, emoji)
      await refresh()
    } catch {
      setToast('Could not react to that Wave.')
    }
  }

  if (loading) return <main className="waves-page waves-loading"><div className="waves-logo">W</div><span>Loading Waves</span></main>
  if (!session) {
    window.location.replace('/')
    return null
  }

  return (
    <main className="waves-page">
      <header className="waves-topbar">
        <a href="/" aria-label="Back to Wavo"><ArrowLeft size={19} /></a>
        <div><span>WAVO</span><strong>Waves</strong></div>
        <button onClick={() => setComposerOpen(true)}><Plus size={19} /> New Wave</button>
      </header>

      <section className="waves-intro">
        <div><span>YOUR PEOPLE</span><h1>Waves</h1><p>Photos, short videos and updates shared only with friends or people you choose.</p></div>
        <button onClick={() => setComposerOpen(true)}><Plus size={19} /> Share</button>
      </section>

      <section className="waves-feed">
        {visiblePosts.length ? visiblePosts.map((post) => (
          <WaveCard key={post.id} post={post} userId={userId} onReply={setReplyPost} onDelete={remove} onReact={react} />
        )) : (
          <div className="waves-empty"><MessageCircle size={24} /><strong>No Waves yet</strong><span>Share something with the people you've added.</span><button onClick={() => setComposerOpen(true)}>Create the first Wave</button></div>
        )}

        {visibleCount < posts.length ? (
          <button className="waves-older" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>Show older Waves</button>
        ) : posts.length > 0 ? (
          <div className="waves-caught-up"><Check size={17} /> You're caught up</div>
        ) : null}
      </section>

      <Composer open={composerOpen} onClose={() => setComposerOpen(false)} userId={userId} friends={friends} onCreated={refresh} />
      <ReplyBox post={replyPost} userId={userId} onClose={(message) => { setReplyPost(null); if (message) setToast(message) }} />
      {toast && <button className="waves-toast" onClick={() => setToast('')}>{toast}</button>}
    </main>
  )
}
