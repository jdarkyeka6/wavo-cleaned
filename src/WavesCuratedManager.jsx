import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ExternalLink, HelpCircle, Maximize2, Minimize2, RotateCcw, X } from 'lucide-react'
import { supabase } from './supabaseClient'
import { channelBySlug } from './wavesCuratedData'
import './waves-curated-manager.css'

const FIELDS = 'clip_id,drive_source_url,source_filename,decision,decided_at,rights_verified,audio_verified,edited,content_approved,licence_notes'
const VIEWS = [
  { value: 'pending', label: 'To review' },
  { value: 'yes', label: 'Yes' },
  { value: 'maybe', label: 'Maybe' },
  { value: 'no', label: 'No' },
]

function previewUrl(url) {
  const match = /^https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)(?:\/|\?|$)/.exec(url || '')
  return match ? 'https://drive.google.com/file/d/' + match[1] + '/preview' : null
}

function textFor(clip) {
  const channel = channelBySlug[clip.channel_slug]
  const filename = clip.review.source_filename || clip.title
  return { channel, filename }
}

export default function WavesCuratedManager({ userId, onClose, onChanged }) {
  const [clips, setClips] = useState([])
  const [view, setView] = useState('pending')
  const [activeId, setActiveId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [widePreview, setWidePreview] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      // Two admin-only queries. Public viewers cannot access review/source URLs.
      const [clipResponse, reviewResponse] = await Promise.all([
        supabase.from('waves_curated_clips')
          .select('id,channel_slug,title,status,media_path,playback_url,playback_hls_url,video_provider,video_asset_id,created_at')
          .order('created_at', { ascending: false }).limit(300),
        supabase.from('waves_curated_reviews').select(FIELDS).limit(300),
      ])
      if (clipResponse.error) throw clipResponse.error
      if (reviewResponse.error) throw reviewResponse.error
      const byId = new Map((reviewResponse.data || []).map((review) => [review.clip_id, review]))
      const next = (clipResponse.data || [])
        .filter((clip) => byId.has(clip.id))
        .map((clip) => ({ ...clip, review: byId.get(clip.id) }))
      setClips(next)
      setActiveId((old) => old && next.some((clip) => clip.id === old) ? old : next.find((clip) => clip.review.decision === 'pending')?.id || null)
    } catch (loadError) {
      setError('Could not open your review queue. ' + (loadError.message || 'Try Refresh.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => clips.filter((clip) => clip.review.decision === view), [clips, view])
  const selected = filtered.find((clip) => clip.id === activeId) || filtered[0] || null
  const index = selected ? filtered.findIndex((clip) => clip.id === selected.id) : -1
  const pending = clips.filter((clip) => clip.review.decision === 'pending').length
  const approved = clips.filter((clip) => clip.review.decision === 'yes').length
  const maybe = clips.filter((clip) => clip.review.decision === 'maybe').length
  const rejected = clips.filter((clip) => clip.review.decision === 'no').length

  const navigate = useCallback((delta) => {
    if (!filtered.length) return
    const current = filtered.findIndex((clip) => clip.id === activeId)
    const next = Math.max(0, Math.min(filtered.length - 1, (current < 0 ? 0 : current) + delta))
    setActiveId(filtered[next].id)
  }, [activeId, filtered])

  const decide = useCallback(async (decision) => {
    if (!selected || saving) return
    const clip = selected
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const { error: updateError } = await supabase.from('waves_curated_reviews')
        .update({
          decision,
          decided_at: decision === 'pending' ? null : new Date().toISOString(),
          decided_by: decision === 'pending' ? null : userId,
        }).eq('clip_id', clip.id)
      if (updateError) throw updateError
      // A Yes is a request to release the clip. Only a video that is already
      // hosted AND has independently reviewed footage, audio and content can
      // change its public status. The DB trigger enforces the final gate.
      const eligibleForRelease = Boolean(
        (clip.media_path || clip.playback_url || clip.playback_hls_url) && clip.review.rights_verified &&
        clip.review.audio_verified && clip.review.edited &&
        clip.review.content_approved && clip.review.licence_notes?.trim()
      )
      let nextStatus = clip.status
      if (decision === 'yes' && eligibleForRelease && clip.status !== 'published') {
        const { error: publishError } = await supabase.from('waves_curated_clips')
          .update({ status: 'published', published_at: new Date().toISOString() })
          .eq('id', clip.id).eq('status', 'draft')
        if (publishError) {
          setNotice('Yes saved, but automatic publication needs attention: ' + publishError.message)
        } else {
          nextStatus = 'published'
          onChanged?.()
        }
      } else if (decision !== 'yes' && clip.status === 'published') {
        const { error: unpublishError } = await supabase.from('waves_curated_clips')
          .update({ status: 'draft', published_at: null })
          .eq('id', clip.id).eq('status', 'published')
        if (unpublishError) {
          setNotice('Your choice was saved, but the public clip could not be unpublished: ' + unpublishError.message)
        } else {
          nextStatus = 'draft'
          onChanged?.()
        }
      }
      const updated = clips.map((item) => item.id === clip.id
        ? { ...item, status: nextStatus, review: { ...item.review, decision } }
        : item)
      setClips(updated)
      if (decision === 'pending') {
        setView('pending')
        setActiveId(clip.id)
        setNotice('Returned to the review queue.')
      } else {
        const queue = view === 'maybe' ? 'maybe' : 'pending'
        const remaining = updated.filter((item) => item.review.decision === queue)
        const next = filtered[index + 1]?.id
        setView(queue)
        setActiveId(remaining.find((item) => item.id === next)?.id || remaining[0]?.id || null)
        if (nextStatus === 'published' && decision === 'yes') setNotice('Yes saved. This cleared video is now public on Waves.')
        else if (decision === 'yes') setNotice('Yes saved. This clip remains private until the actual video is hosted and its footage and audio rights are cleared.')
        else setNotice(decision === 'no' ? 'Saved: no. Next video!' : 'Saved: maybe. Next video!')
      }
    } catch (updateError) {
      setError('Could not save your choice. ' + (updateError.message || 'Try again.'))
    } finally {
      setSaving(false)
    }
  }, [clips, filtered, index, saving, selected, userId, view, onChanged])

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return
      const target = event.target
      if (target instanceof HTMLElement && (
        ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) || target.isContentEditable
      )) return
      if (event.key.toLowerCase() === 'y' && (view === 'pending' || view === 'maybe')) { event.preventDefault(); decide('yes') }
      if (event.key.toLowerCase() === 'm' && view === 'pending') { event.preventDefault(); decide('maybe') }
      if (event.key.toLowerCase() === 'n' && (view === 'pending' || view === 'maybe')) { event.preventDefault(); decide('no') }
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); navigate(1) }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); navigate(-1) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [decide, navigate, view])

  const details = selected ? textFor(selected) : null
  const src = selected ? previewUrl(selected.review.drive_source_url) : null

  return <main className="waves-curator" aria-label="Waves Studio quick review">
    <header className="waves-curator-header">
      <button type="button" onClick={onClose}><ArrowLeft size={19} /> Waves</button>
      <strong>Waves Studio <span>· Quick review</span></strong>
      <button type="button" onClick={load} aria-label="Refresh review queue" disabled={saving || loading}><RotateCcw size={18} /></button>
    </header>

    <div className="waves-curator-review">
      <nav className="waves-curator-tabs" aria-label="Review status">
        {VIEWS.map((option) => <button type="button" key={option.value}
          className={view === option.value ? 'active' : ''}
          onClick={() => { setView(option.value); setActiveId(null); setError(''); setNotice('') }}>
          {option.label} <span>{option.value === 'pending' ? pending : option.value === 'yes' ? approved : option.value === 'maybe' ? maybe : rejected}</span>
        </button>)}
      </nav>

      {error && <div className="waves-curator-alert" role="alert">{error}</div>}
      {notice && <div className="waves-curator-note" role="status">{notice}</div>}

      {loading ? <div className="waves-curator-empty">Finding your videos…</div> :
        !selected ? <div className="waves-curator-empty">
          <div className="waves-curator-done"><Check size={31} /></div>
          <h1>{view === 'pending' ? 'All caught up!' : 'Nothing here yet'}</h1>
          <p>{view === 'pending'
            ? 'Your choices are saved. Your Yes picks still need their footage and audio rights checked before publishing.'
            : 'Go back to To review to see the remaining videos.'}</p>
          <button type="button" onClick={() => { setView(view === 'pending' ? 'yes' : 'pending'); setActiveId(null) }}>{view === 'pending' ? 'See my Yes picks' : 'Back to review'}</button>
        </div> :
        <div className={'waves-curator-stage' + (widePreview ? ' widescreen' : '')}>
          <div className="waves-curator-player">
            <div className="waves-curator-player-heading">
              <div className="waves-curator-counter">{index + 1} / {filtered.length}</div>
              <span>{details?.channel?.emoji || '🌊'} @{details?.channel?.handle || 'wavesfunny'}</span>
              <button type="button" className="waves-curator-wide-button" onClick={() => setWidePreview((old) => !old)}>{widePreview ? <Minimize2 size={14}/> : <Maximize2 size={14}/>} {widePreview ? 'Portrait' : 'Wide view'}</button>
            </div>
            {src ? <iframe key={selected.id} src={src} title={'Preview ' + details.filename}
              loading="eager" allow="autoplay; fullscreen" allowFullScreen referrerPolicy="no-referrer" />
              : <div className="waves-curator-no-preview">Preview unavailable. Open the clip in Drive.</div>}
            <div className="waves-curator-player-foot">
              <span title={details.filename}>{details.filename}</span>
              {selected.status === 'published' && <span className="waves-curator-review-status">Public on Waves</span>}
              {selected.review.drive_source_url && <a href={selected.review.drive_source_url} target="_blank" rel="noreferrer">
                Play with sound in Drive <ExternalLink size={15} />
              </a>}
            </div>
          </div>
          <div className="waves-curator-review-controls">
            <div className="waves-curator-steps">
              <button type="button" onClick={() => navigate(-1)} disabled={saving || index <= 0} aria-label="Previous video"><ChevronLeft size={23}/></button>
              <span>Watch, then choose.</span>
              <button type="button" onClick={() => navigate(1)} disabled={saving || index === filtered.length - 1} aria-label="Next video"><ArrowRight size={22}/></button>
            </div>
            {(view === 'pending' || view === 'maybe') ? <>
              <div className="waves-curator-vote">
                <button className="no" type="button" onClick={() => decide('no')} disabled={saving}><X size={25} /> No</button>
                {view === 'pending' && <button className="maybe" type="button" onClick={() => decide('maybe')} disabled={saving}><HelpCircle size={23} /> Maybe</button>}
                <button className="yes" type="button" onClick={() => decide('yes')} disabled={saving}><Check size={25} /> Yes</button>
              </div>
              {view === 'maybe' && <button className="waves-curator-undo" type="button" disabled={saving} onClick={() => decide('pending')}>
                <RotateCcw size={17}/> Back to To review
              </button>}
            </> : <button className="waves-curator-undo" type="button" disabled={saving} onClick={() => decide('pending')}>
              <RotateCcw size={17}/> Change my mind
            </button>}
            <p className="waves-curator-explainer">
              If Drive's player looks cropped, choose Wide view. Yes = approve for public release once the edited file is hosted and footage and audio rights are cleared. Maybe = decide later. No = reject. Choices save automatically.
            </p>
            <p className="waves-curator-shortcuts">Keyboard: Y = Yes · M = Maybe · N = No · ← / → = previous / next</p>
          </div>
        </div>}
    </div>
  </main>
}
