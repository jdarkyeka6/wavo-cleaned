import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { LockKeyhole, Radio, X } from 'lucide-react'
import { supabase } from './supabaseClient'
import { getTogetherSnapshot } from './togetherData'
import {
  endLiveActivity,
  getLiveActivityState,
  liveActivitiesSupported,
  startLiveActivity,
  updateLiveActivity,
} from './liveActivityBridge'
import './live-activity.css'

const STORAGE_KEY = 'wavo_live_activity'

function fmt(ts) {
  return new Date(ts).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

function savedActivity() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') } catch { return null }
}

function saveActivity(value) {
  if (!value) localStorage.removeItem(STORAGE_KEY)
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
}

export default function LiveActivityCoordinator() {
  const [session, setSession] = useState(null)
  const [snapshot, setSnapshot] = useState(null)
  const [nativeState, setNativeState] = useState(null)
  const [active, setActive] = useState(savedActivity)
  const [mount, setMount] = useState(null)
  const [busy, setBusy] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const userId = session?.user?.id

  useEffect(() => {
    if (!liveActivitiesSupported()) return undefined
    let alive = true
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return
      setSession(data?.session || null)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => alive && setSession(next))
    return () => {
      alive = false
      listener?.subscription?.unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    if (!liveActivitiesSupported()) return undefined
    let disposed = false
    function syncMount() {
      const root = document.querySelector('.people-dashboard-mount')
      if (!disposed) setMount(root || null)
    }
    const observer = new MutationObserver(syncMount)
    observer.observe(document.body, { childList: true, subtree: true })
    syncMount()
    return () => { disposed = true; observer.disconnect() }
  }, [])

  async function refresh(id = userId) {
    if (!id || !liveActivitiesSupported()) return
    try {
      const [nextSnapshot, state] = await Promise.all([getTogetherSnapshot(id), getLiveActivityState()])
      setSnapshot(nextSnapshot)
      setNativeState(state)

      const stored = savedActivity()
      if (stored) {
        const invite = (nextSnapshot?.invites || []).find((row) => row.id === stored.inviteId)
        if (!invite || new Date(invite.ends_at) <= new Date()) {
          try { await endLiveActivity(stored.activityId) } catch {}
          saveActivity(null)
          setActive(null)
        } else {
          const going = (invite.responses || []).filter((response) => response.response === 'yep').length
          try {
            await updateLiveActivity({
              id: stored.activityId,
              subtitle: invite.location || `Starts ${fmt(invite.starts_at)}`,
              detail: invite.note || '',
              participantCount: going,
              startsAt: invite.starts_at,
              endsAt: invite.ends_at,
            })
          } catch {}
          setActive(stored)
        }
      }
    } catch (err) {
      console.info('[wavo live activity] refresh skipped', err?.message || err)
    }
  }

  useEffect(() => {
    if (!userId || !liveActivitiesSupported()) return undefined
    refresh(userId)
    const timer = window.setInterval(() => refresh(userId), 30000)
    const created = () => { setDismissed(false); refresh(userId) }
    window.addEventListener('wavo:smart-action-created', created)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('wavo:smart-action-created', created)
    }
  }, [userId])

  const candidate = useMemo(() => {
    if (!userId) return null
    return (snapshot?.invites || [])
      .filter((invite) => {
        if (new Date(invite.ends_at) <= new Date()) return false
        if (invite.owner_id === userId) return true
        return (invite.responses || []).some((response) => response.user_id === userId && response.response === 'yep')
      })
      .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))[0] || null
  }, [snapshot, userId])

  async function pin() {
    if (!candidate || busy) return
    setBusy(true)
    try {
      if (active?.activityId) {
        try { await endLiveActivity(active.activityId) } catch {}
      }
      const going = (candidate.responses || []).filter((response) => response.response === 'yep').length
      const result = await startLiveActivity({
        kind: 'come',
        title: candidate.title,
        subtitle: candidate.location || `Starts ${fmt(candidate.starts_at)}`,
        detail: candidate.note || '',
        participantCount: going,
        startsAt: candidate.starts_at,
        endsAt: candidate.ends_at,
        deepLink: 'wavo://together',
      })
      if (result?.id) {
        const stored = { activityId: result.id, inviteId: candidate.id }
        saveActivity(stored)
        setActive(stored)
      }
    } catch (err) {
      console.error('[wavo live activity] start failed', err)
    } finally {
      setBusy(false)
    }
  }

  async function unpin() {
    if (!active?.activityId || busy) return
    setBusy(true)
    try { await endLiveActivity(active.activityId) } catch {}
    saveActivity(null)
    setActive(null)
    setBusy(false)
  }

  if (!liveActivitiesSupported() || !mount || !candidate || dismissed) return null
  if (nativeState && (!nativeState.supported || !nativeState.enabled)) return null

  return createPortal(
    <div className="wavo-live-activity-card">
      <span className="wla-icon"><Radio size={17} /></span>
      <div className="wla-copy">
        <small>LOCK SCREEN + DYNAMIC ISLAND</small>
        <strong>{active?.inviteId === candidate.id ? `${candidate.title} is live` : `Pin ${candidate.title}`}</strong>
        <span>{candidate.location || fmt(candidate.starts_at)}</span>
      </div>
      {active?.inviteId === candidate.id
        ? <button className="wla-action secondary" onClick={unpin} disabled={busy}>End</button>
        : <button className="wla-action" onClick={pin} disabled={busy}><LockKeyhole size={14} />{busy ? 'Pinning…' : 'Pin'}</button>}
      {!active && <button className="wla-close" onClick={() => setDismissed(true)} aria-label="Dismiss"><X size={15} /></button>}
    </div>,
    mount,
  )
}
