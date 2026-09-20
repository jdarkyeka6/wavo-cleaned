import { useEffect, useState } from 'react'
import { ArrowLeft, Check, ExternalLink, FileVideo2, FolderPlus, RefreshCw, UploadCloud, X } from 'lucide-react'
import { supabase } from './supabaseClient'
import { CURATED_CHANNELS } from './wavesCuratedData'
import './waves-curated-manager.css'

const STORAGE_BUCKET = 'waves-curated'
const MAX_FILE = 50 * 1024 * 1024
const reviewFields = ['rights_verified', 'audio_verified', 'edited', 'content_approved']
const blankChecks = { rights_verified: false, audio_verified: false, edited: false, content_approved: false }

async function durationMs(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    const cleanup = () => { URL.revokeObjectURL(url); video.removeAttribute('src'); video.load() }
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      const ms = video.duration * 1000
      cleanup()
      if (!Number.isFinite(ms) || ms <= 0) reject(new Error('Could not read video duration.'))
      else resolve(ms)
    }
    video.onerror = () => { cleanup(); reject(new Error('Could not read this video.')) }
    video.src = url
  })
}

export default function WavesCuratedManager({ userId, onClose, onChanged }) {
  const [items, setItems] = useState([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [filter, setFilter] = useState('all')
  const [sourceUrl, setSourceUrl] = useState('')
  const [newName, setNewName] = useState('')
  const [newChannel, setNewChannel] = useState('funny')
  const [pendingFiles, setPendingFiles] = useState({})

  async function reload() {
    const [clips, reviews] = await Promise.all([
      supabase.from('waves_curated_clips')
        .select('id,channel_slug,title,caption,media_path,source_credit,status,created_at')
        .order('created_at', { ascending: false }).limit(200),
      supabase.from('waves_curated_reviews').select('*').limit(200),
    ])
    if (clips.error) throw clips.error
    if (reviews.error) throw reviews.error
    const reviewMap = new Map((reviews.data || []).map((review) => [review.clip_id, review]))
    setItems((clips.data || []).map((clip) => ({
      ...clip, review: {
        clip_id: clip.id,
        drive_source_url: '',
        source_filename: '',
        licence_notes: '',
        ...blankChecks,
        ...(reviewMap.get(clip.id) || {}),
      },
    })))
  }

  useEffect(() => {
    let alive = true
    reload().catch((err) => { if (alive) setError(err.message || 'Could not load curator queue.') })
    return () => { alive = false }
  }, [])

  function editClip(id, field, value) {
    setItems((existing) => existing.map((clip) => clip.id === id ? { ...clip, [field]: value } : clip))
  }

  function editReview(id, field, value) {
    setItems((existing) => existing.map((clip) => clip.id === id
      ? { ...clip, review: { ...clip.review, [field]: value } } : clip))
  }

  async function work(label, action) {
    if (busy) return
    setBusy(label)
    setError('')
    setMessage('')
    try { await action(); setMessage('Saved.'); await reload() }
    catch (err) { setError(err.message || 'Could not save this change.') }
    finally { setBusy('') }
  }

  async function stage(event) {
    event.preventDefault()
    await work('stage', async () => {
      if (!newName.trim()) throw new Error('Give this candidate a descriptive title.')
      if (sourceUrl.trim() && !/^https:\/\/drive\.google\.com\//i.test(sourceUrl.trim())) {
        throw new Error('Use a Google Drive source link or leave it empty.')
      }
      const { data, error: createError } = await supabase.from('waves_curated_clips')
        .insert({ channel_slug: newChannel, title: newName.trim().slice(0, 120), created_by: userId })
        .select('id').single()
      if (createError) throw createError
      const { error: reviewError } = await supabase.from('waves_curated_reviews').insert({
        clip_id: data.id, drive_source_url: sourceUrl.trim(),
      })
      if (reviewError) {
        await supabase.from('waves_curated_clips').delete().eq('id', data.id)
        throw reviewError
      }
      setNewName('')
      setSourceUrl('')
    })
  }

  async function save(row, shouldPublish = false) {
    await work(row.id + (shouldPublish ? ':publish' : ':save'), async () => {
      if (row.status === 'published' && !shouldPublish) {
        const { error: unpublishError } = await supabase.from('waves_curated_clips')
          .update({ status: 'draft', published_at: null }).eq('id', row.id)
        if (unpublishError) throw unpublishError
        return
      }
      const { error: clipError } = await supabase.from('waves_curated_clips').update({
        title: row.title.trim().slice(0, 120),
        caption: row.caption.trim().slice(0, 1200),
        channel_slug: row.channel_slug,
        source_credit: row.source_credit.trim().slice(0, 200),
      }).eq('id', row.id)
      if (clipError) throw clipError
      const review = row.review
      const { error: reviewError } = await supabase.from('waves_curated_reviews').upsert({
        clip_id: row.id,
        drive_source_url: review.drive_source_url.trim(),
        source_filename: review.source_filename.trim().slice(0, 200),
        licence_notes: review.licence_notes.trim().slice(0, 2000),
        rights_verified: review.rights_verified,
        audio_verified: review.audio_verified,
        edited: review.edited,
        content_approved: review.content_approved,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'clip_id' })
      if (reviewError) throw reviewError
      if (shouldPublish) {
        if (!row.media_path) throw new Error('Upload the reviewed and edited MP4 first.')
        if (!reviewFields.every((field) => review[field])) throw new Error('Finish all four review checks first.')
        if (!review.licence_notes.trim()) throw new Error('Record the rights evidence or creator permission before publishing.')
        const { error: publishError } = await supabase.from('waves_curated_clips')
          .update({ status: 'published', published_at: new Date().toISOString() }).eq('id', row.id)
        if (publishError) throw publishError
        await onChanged?.()
      }
    })
  }

  async function upload(clip) {
    const file = pendingFiles[clip.id]
    if (!file) { setError('Choose a reviewed and edited video first.'); return }
    await work(clip.id + ':upload', async () => {
      if (!['video/mp4', 'video/quicktime'].includes(file.type)) throw new Error('Choose an MP4 or MOV video.')
      if (file.size > MAX_FILE) throw new Error('The video must be under 50 MB.')
      if (await durationMs(file) > 60_000) throw new Error('The video must be 60 seconds or shorter.')
      const extension = file.type === 'video/quicktime' ? '.mov' : '.mp4'
      const path = userId + '/curated/' + crypto.randomUUID() + extension
      const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false })
      if (uploadError) throw uploadError
      const { error: saveError } = await supabase.from('waves_curated_clips')
        .update({ media_path: path }).eq('id', clip.id).eq('status', 'draft')
      if (saveError) {
        await supabase.storage.from(STORAGE_BUCKET).remove([path])
        throw saveError
      }
      if (clip.media_path) await supabase.storage.from(STORAGE_BUCKET).remove([clip.media_path])
      setPendingFiles((current) => ({ ...current, [clip.id]: null }))
    })
  }

  const visible = items.filter((row) => filter === 'all' || row.channel_slug === filter)

  return <main className="waves-curator" aria-label="Waves curator">
    <header className="waves-curator-header">
      <button type="button" onClick={onClose}><ArrowLeft size={20} /> Back to Waves</button>
      <strong>Waves Studio <span>· Curated collections</span></strong>
      <button type="button" onClick={() => work('refresh', reload)} disabled={Boolean(busy)} aria-label="Refresh"><RefreshCw size={18} /></button>
    </header>
    <div className="waves-curator-body">
      <div className="waves-curator-intro">
        <h1>Choose the clips. Build the channels.</h1>
        <p>Every candidate starts in a private review queue. The Google Drive source link stays private and is never streamed to viewers. Only edited clips with documented footage and music permissions can be published to a labelled Wavo-curated channel.</p>
      </div>
      {error && <p className="waves-curator-error" role="alert">{error}</p>}
      {message && <p className="waves-curator-success" role="status">{message}</p>}

      <form className="waves-curator-stage" onSubmit={stage}>
        <h2><FolderPlus size={20} /> Add candidate from Google Drive</h2>
        <label>Working title<input required value={newName} maxLength={120} onChange={(event) => setNewName(event.target.value)} placeholder="e.g. Cat steals the sofa" /></label>
        <label>Private source link<input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://drive.google.com/file/d/…" /></label>
        <label>Channel<select value={newChannel} onChange={(event) => setNewChannel(event.target.value)}>
          {CURATED_CHANNELS.map((channel) => <option key={channel.slug} value={channel.slug}>{channel.emoji} @{channel.handle}</option>)}
        </select></label>
        <button className="waves-curator-cta" disabled={Boolean(busy)} type="submit">Add to review queue</button>
      </form>

      <nav className="waves-curator-filters" aria-label="Filter candidates">
        <button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>All ({items.length})</button>
        {CURATED_CHANNELS.map((channel) => <button key={channel.slug} className={filter === channel.slug ? 'selected' : ''} onClick={() => setFilter(channel.slug)}>
          {channel.emoji} {channel.name} ({items.filter((item) => item.channel_slug === channel.slug).length})
        </button>)}
      </nav>

      <section className="waves-curator-candidates">
        {visible.length === 0 && <p>No candidates in this channel yet. Add a Google Drive link above.</p>}
        {visible.map((clip) => <article key={clip.id} className="waves-curator-item">
          <div className="waves-curator-item-heading">
            <span className={clip.status === 'published' ? 'waves-curator-live' : 'waves-curator-draft'}>{clip.status === 'published' ? 'LIVE' : 'PRIVATE DRAFT'}</span>
            <strong>{clip.title}</strong>
            {clip.review.drive_source_url && <a href={clip.review.drive_source_url} target="_blank" rel="noreferrer">View source <ExternalLink size={13} /></a>}
          </div>
          <div className="waves-curator-fields">
            <label>Channel<select value={clip.channel_slug} onChange={(event) => editClip(clip.id, 'channel_slug', event.target.value)} disabled={clip.status === 'published'}>
              {CURATED_CHANNELS.map((channel) => <option key={channel.slug} value={channel.slug}>@{channel.handle}</option>)}
            </select></label>
            <label>Title<input value={clip.title} maxLength={120} onChange={(event) => editClip(clip.id, 'title', event.target.value)} /></label>
            <label>Caption<textarea value={clip.caption} maxLength={1200} onChange={(event) => editClip(clip.id, 'caption', event.target.value)} /></label>
            <label>Original creator / source attribution<input value={clip.source_credit} maxLength={200} onChange={(event) => editClip(clip.id, 'source_credit', event.target.value)} placeholder="Credit when known; don't impersonate" /></label>
            <label>Private Google Drive source<input value={clip.review.drive_source_url} onChange={(event) => editReview(clip.id, 'drive_source_url', event.target.value)} /></label>
            <label>Original filename<input value={clip.review.source_filename} onChange={(event) => editReview(clip.id, 'source_filename', event.target.value)} /></label>
            <label>Licence / permission evidence<textarea value={clip.review.licence_notes} maxLength={2000} onChange={(event) => editReview(clip.id, 'licence_notes', event.target.value)} placeholder="What establishes the original footage and audio rights for Wavo's own ad-supported stream?" /></label>
          </div>
          {clip.status !== 'published' && <div className="waves-curator-upload">
            <label><FileVideo2 size={18} /> Choose the edited MP4/MOV <input type="file" accept="video/mp4,video/quicktime,.mp4,.mov" onChange={(event) => setPendingFiles((current) => ({ ...current, [clip.id]: event.target.files?.[0] || null }))} /></label>
            <button type="button" onClick={() => upload(clip)} disabled={Boolean(busy) || !pendingFiles[clip.id]}><UploadCloud size={17} /> {clip.media_path ? 'Replace hosted clip' : 'Upload reviewed clip'}</button>
            {clip.media_path && <span><Check size={15} /> Hosted file attached</span>}
          </div>}
          <div className="waves-curator-checks">
            <label><input type="checkbox" checked={clip.review.rights_verified} onChange={(event) => editReview(clip.id, 'rights_verified', event.target.checked)} /> Original footage licensed for Waves</label>
            <label><input type="checkbox" checked={clip.review.audio_verified} onChange={(event) => editReview(clip.id, 'audio_verified', event.target.checked)} /> Audio and music rights checked</label>
            <label><input type="checkbox" checked={clip.review.edited} onChange={(event) => editReview(clip.id, 'edited', event.target.checked)} /> Required edits completed</label>
            <label><input type="checkbox" checked={clip.review.content_approved} onChange={(event) => editReview(clip.id, 'content_approved', event.target.checked)} /> Quality and safety reviewed</label>
          </div>
          <div className="waves-curator-item-actions">
            <button type="button" onClick={() => save(clip)} disabled={Boolean(busy)}>{clip.status === 'published' ? 'Unpublish' : 'Save draft'}</button>
            {clip.status !== 'published' && <button type="button" className="waves-curator-cta" onClick={() => save(clip, true)} disabled={Boolean(busy) || !clip.media_path || !reviewFields.every((field) => clip.review[field]) || !clip.review.licence_notes.trim()}>
              Publish to @{CURATED_CHANNELS.find((entry) => entry.slug === clip.channel_slug)?.handle}
            </button>}
          </div>
        </article>)}
      </section>
    </div>
  </main>
}
