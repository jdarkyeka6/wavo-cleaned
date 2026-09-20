import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'

// Resumable batch import: server copies private Drive files; no video bytes are
// routed through the browser. The tab must remain open while importing.
export default function WavesBulkImporter({ onChanged }) {
  const [progress, setProgress] = useState(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [batch, setBatch] = useState(null)
  const stopped = useRef(false)
  const active = useRef(false)

  async function request(method, action) {
    const { data: auth } = await supabase.auth.getSession()
    if (!auth?.session?.access_token) throw new Error('Sign in again before importing')
    const response = await fetch('/api/waves-bulk-import', {
      method,
      headers: { Authorization: 'Bearer ' + auth.session.access_token, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify({ action }) } : {}),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.error || 'Import request failed')
    return payload
  }

  useEffect(() => {
    let alive = true
    request('GET').then((payload) => { if (alive) setProgress(payload.progress) })
      .catch((err) => { if (alive) setError(err.message) })
    return () => { alive = false; stopped.current = true }
  }, [])

  async function run() {
    if (active.current) return
    stopped.current = false
    active.current = true
    setWorking(true)
    setError('')
    try {
      let cycles = 0
      while (!stopped.current) {
        const result = await request('POST', cycles === 0 ? 'start' : 'next')
        setProgress(result.progress)
        setBatch(result.batch || null)
        cycles += 1
        if (result.complete) { onChanged?.(); break }
        if (cycles % 10 === 0) onChanged?.()
        // Yield to the browser so Stop responds quickly during large collections.
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    } catch (err) {
      setError(err.message || 'The import stopped. Resume to try again.')
    } finally {
      active.current = false
      setWorking(false)
    }
  }

  return <section className="waves-bulk-import" aria-label="Bulk video import">
    <div className="waves-bulk-import-heading"><strong>📦 Funny Fails bulk importer</strong>
      <span>{progress?.finished ? 'Finished' : working ? 'Importing…' : progress ? 'Ready to resume' : 'Ready'}</span></div>
    <p>Copies your Funny Fails collection into your private Vids folder, assigns hidden tags from video thumbnails where AI is available, and publishes eligible clips to Waves. You do not need to approve them one by one. Keep this tab open while it runs.</p>
    {progress && <p role="status">{progress.files_imported} published · {progress.files_existing} already present/skipped · {progress.files_failed} failed · Folder {Math.min(15, progress.folder_index + 1)} of 15</p>}
    {batch?.tagged ? <p>{batch.tagged} video{batch.tagged === 1 ? '' : 's'} automatically tagged in the latest batch.</p> : null}
    {error && <p className="waves-curator-alert" role="alert">{error}</p>}
    <div className="waves-bulk-import-actions">
      <button type="button" onClick={run} disabled={working || progress?.finished}>{working ? 'Import running…' : progress ? 'Resume import' : 'Import all videos'}</button>
      {working && <button type="button" onClick={() => { stopped.current = true }}>Stop after this batch</button>}
    </div>
  </section>
}
