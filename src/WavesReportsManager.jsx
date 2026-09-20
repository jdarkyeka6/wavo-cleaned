import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

// Reports never expose a reporter's identity to other viewers. Only admins
// can see this queue under waves_video_reports RLS.
export default function WavesReportsManager({ onChanged }) {
  const [reports, setReports] = useState([])
  const [clips, setClips] = useState({})
  const [reviews, setReviews] = useState({})
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)

  async function refresh() {
    setError('')
    const { data, error: fetchError } = await supabase.from('waves_video_reports')
      .select('id,clip_id,reason,details,created_at,status').eq('status','open')
      .order('created_at',{ascending:false}).limit(100)
    if (fetchError) { setError(fetchError.message); return }
    const items = data || []
    setReports(items)
    const ids = [...new Set(items.map((entry) => entry.clip_id))]
    if (!ids.length) { setClips({}); setReviews({}); return }
    const [clipResult, reviewResult] = await Promise.all([
      supabase.from('waves_curated_clips').select('id,title,channel_slug,status,moderation_state,video_provider,video_asset_id').in('id',ids),
      supabase.from('waves_curated_reviews').select('clip_id,drive_source_url').in('clip_id',ids),
    ])
    if (clipResult.error || reviewResult.error) { setError(clipResult.error?.message || reviewResult.error?.message); return }
    setClips(Object.fromEntries((clipResult.data || []).map((item) => [item.id,item])))
    setReviews(Object.fromEntries((reviewResult.data || []).map((item) => [item.clip_id,item])))
  }

  useEffect(() => { if (open) void refresh() }, [open])

  async function act(report, action) {
    if (busy) return
    setBusy(String(report.id))
    setError('')
    try {
      if (action !== 'dismissed') {
        const { error: clipError } = await supabase.from('waves_curated_clips')
          .update({ moderation_state: action === 'hidden' ? 'hidden' : 'removed' }).eq('id', report.clip_id)
        if (clipError) throw clipError
      }
      const { error: reportError } = await supabase.from('waves_video_reports')
        .update({ status: action === 'dismissed' ? 'dismissed' : 'actioned' }).eq('id', report.id)
      if (reportError) throw reportError
      onChanged?.()
      await refresh()
    } catch (err) { setError(err.message || 'Could not save report action') }
    finally { setBusy('') }
  }

  const preview = (clipId) => {
    const url = reviews[clipId]?.drive_source_url || ''
    const match = /^https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/.exec(url)
    return match ? 'https://drive.google.com/file/d/' + match[1] + '/preview' : null
  }

  return <section className="waves-reports">
    <button className="waves-reports-toggle" type="button" onClick={() => setOpen((old) => !old)}>
      🚩 Reports {open ? '▴' : '▾'} {open ? '(' + reports.length + ' open)' : ''}
    </button>
    {open && <>
      <p>Review reported clips. Hide removes a video from For You while retaining its record; remove keeps it off Waves.</p>
      <button type="button" onClick={refresh} disabled={Boolean(busy)}>Refresh reports</button>
      {error && <p className="waves-curator-alert" role="alert">{error}</p>}
      {!reports.length && <p>No open reports.</p>}
      {reports.map((report) => <div className="waves-reports-item" key={report.id}>
        <strong>{clips[report.clip_id]?.title || 'Video'} · {report.reason}</strong>
        <span>{new Date(report.created_at).toLocaleString()}</span>
        {report.details && <p>{report.details}</p>}
        {preview(report.clip_id) && <iframe title="Reported video preview" src={preview(report.clip_id)} allow="fullscreen" referrerPolicy="no-referrer" />}
        <div>
          <button type="button" disabled={Boolean(busy)} onClick={() => act(report,'dismissed')}>Dismiss report</button>
          <button type="button" disabled={Boolean(busy)} onClick={() => act(report,'hidden')}>Hide clip</button>
          <button type="button" disabled={Boolean(busy)} onClick={() => act(report,'removed')}>Remove clip</button>
        </div>
      </div>)}
    </>}
  </section>
}
