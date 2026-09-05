import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, ExternalLink, Music2, RefreshCw, Unplug } from 'lucide-react'
import { supabase } from './supabaseClient'
import './spotify-presence.css'

export default function SpotifyPresenceCoordinator() {
  const [userId, setUserId] = useState(null)
  const [target, setTarget] = useState(null)
  const [connected, setConnected] = useState(false)
  const [connection, setConnection] = useState(null)
  const [playing, setPlaying] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const connectedRef = useRef(false)

  useEffect(() => { connectedRef.current = connected }, [connected])

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(({ data }) => {
      if (alive) setUserId(data?.session?.user?.id || null)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!alive) return
      setUserId(session?.user?.id || null)
      if (!session?.user) {
        setConnected(false)
        setConnection(null)
      }
    })
    return () => {
      alive = false
      listener?.subscription?.unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    let disposed = false
    function syncTarget() {
      if (!disposed) setTarget(document.querySelector('.next-sharing-card'))
    }
    syncTarget()
    const observer = new MutationObserver(syncTarget)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      disposed = true
      observer.disconnect()
    }
  }, [])

  async function status({ quiet = false } = {}) {
    if (!userId) return
    if (!quiet) setBusy(true)
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('spotify-oauth', {
        body: { action: 'status' },
      })
      if (invokeError) throw invokeError
      setConnected(Boolean(data?.connected))
      setConnection(data?.connection || null)
      if (!data?.connected) setPlaying(null)
      setError('')
    } catch (err) {
      if (!quiet) setError('Spotify connection is not ready on Wavo yet.')
      console.info('[wavo spotify] status', err)
    } finally {
      if (!quiet) setBusy(false)
    }
  }

  async function syncNow({ quiet = true } = {}) {
    if (!userId || !connectedRef.current) return
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('spotify-now', { body: {} })
      if (invokeError) throw invokeError
      if (typeof data?.connected === 'boolean' && !data.connected) {
        setConnected(false)
        setConnection(null)
      }
      setPlaying(data?.playing ? data?.activity || true : null)
      if (!quiet && data?.error) setError(data.error)
    } catch (err) {
      if (!quiet) setError('Could not refresh Spotify right now.')
      console.info('[wavo spotify] sync', err)
    }
  }

  useEffect(() => {
    if (!userId) return undefined
    status({ quiet: true }).then(() => syncNow({ quiet: true }))

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && connectedRef.current) syncNow({ quiet: true })
    }, 30_000)

    const onReturn = () => {
      if (document.visibilityState !== 'visible') return
      status({ quiet: true }).then(() => syncNow({ quiet: true }))
    }
    window.addEventListener('focus', onReturn)
    document.addEventListener('visibilitychange', onReturn)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onReturn)
      document.removeEventListener('visibilitychange', onReturn)
    }
  }, [userId])

  async function connectSpotify() {
    if (!userId || busy) return
    setBusy(true)
    setError('')
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('spotify-oauth', {
        body: { action: 'start' },
      })
      if (invokeError) throw invokeError
      if (!data?.url) throw new Error('Spotify did not return a connection link.')
      const opened = window.open(data.url, '_blank', 'noopener,noreferrer')
      if (!opened) window.location.assign(data.url)
    } catch (err) {
      console.error('[wavo spotify] connect', err)
      setError('Spotify setup is not ready yet.')
    } finally {
      setBusy(false)
    }
  }

  async function disconnectSpotify() {
    if (!userId || busy) return
    setBusy(true)
    setError('')
    try {
      const { error: invokeError } = await supabase.functions.invoke('spotify-oauth', {
        body: { action: 'disconnect' },
      })
      if (invokeError) throw invokeError
      setConnected(false)
      setConnection(null)
      setPlaying(null)
    } catch (err) {
      console.error('[wavo spotify] disconnect', err)
      setError('Could not disconnect Spotify.')
    } finally {
      setBusy(false)
    }
  }

  if (!target || !userId) return null

  return createPortal(
    <div className="wavo-spotify-connect">
      <div className="wavo-spotify-connect-head">
        <span className="wavo-spotify-icon"><Music2 size={18} /></span>
        <div>
          <strong>Spotify activity</strong>
          <span>{connected ? `Connected${connection?.display_name ? ` as ${connection.display_name}` : ''}` : 'Connect Spotify to share what you are actually listening to.'}</span>
        </div>
        {connected && <CheckCircle2 className="wavo-spotify-ok" size={18} />}
      </div>

      {connected ? (
        <div className="wavo-spotify-actions">
          <button onClick={() => syncNow({ quiet: false })} disabled={busy}><RefreshCw size={15} />{playing ? 'Playing now synced' : 'Check now'}</button>
          <button className="disconnect" onClick={disconnectSpotify} disabled={busy}><Unplug size={15} />Disconnect</button>
        </div>
      ) : (
        <button className="wavo-spotify-primary" onClick={connectSpotify} disabled={busy}>
          <ExternalLink size={15} />{busy ? 'Opening Spotify…' : 'Connect Spotify'}
        </button>
      )}

      {connected && <p>When Spotify sharing is on, Wavo refreshes your current track while Wavo is active. It stores the latest short-lived track state, not a listening history.</p>}
      {error && <button className="wavo-spotify-error" onClick={() => setError('')}>{error}</button>}
    </div>,
    target,
  )
}
