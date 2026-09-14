import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  BriefcaseBusiness,
  Clock3,
  Play,
  RefreshCw,
  Square,
  UserCheck,
  UserMinus,
  Users,
  X,
} from 'lucide-react'
import { supabase } from './supabaseClient'
import './employee-work.css'

const IDLE_AFTER_MS = 60_000
const HEARTBEAT_MS = 10_000

function readStoredUserId() {
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i)
      if (!key || !key.startsWith('sb-') || !key.endsWith('-auth-token')) continue
      const raw = window.localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw)
      const userId = parsed?.user?.id || parsed?.currentSession?.user?.id || parsed?.session?.user?.id
      if (userId) return userId
    }
  } catch (error) {
    console.warn('[wavo-work] could not read stored session', error)
  }
  return null
}

function exactClock(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0))
  const hours = Math.floor(value / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  const secs = value % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

function formatDuration(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0))
  const hours = Math.floor(value / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  if (hours) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  if (minutes) return `${minutes}m`
  return `${value}s`
}

function browserState(lastActivityAt) {
  if (document.visibilityState !== 'visible' || !document.hasFocus()) return 'away'
  if (Date.now() - lastActivityAt >= IDLE_AFTER_MS) return 'idle'
  return 'focused'
}

function sessionSeconds(session, now = Date.now()) {
  if (!session?.started_at) return 0
  const start = new Date(session.started_at).getTime()
  const end = session.ended_at ? new Date(session.ended_at).getTime() : now
  return Math.max(0, Math.floor((end - start) / 1000))
}

function EmployeeTimer({ userId }) {
  const [session, setSession] = useState(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('focused')
  const [now, setNow] = useState(Date.now())
  const lastActivityRef = useRef(Date.now())
  const sessionRef = useRef(null)
  const stateRef = useRef('focused')

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  const heartbeat = useCallback(async (state = stateRef.current, stop = false) => {
    const id = sessionRef.current?.id
    if (!id) return
    const rpc = stop ? 'stop_employee_work_session' : 'record_employee_work_heartbeat'
    const { data, error } = await supabase.rpc(rpc, { p_session_id: id, p_state: state })
    if (error) throw error
    if (data && !stop) {
      sessionRef.current = data
      setSession(data)
    }
  }, [])

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data, error } = await supabase
        .from('employee_work_sessions')
        .select('*')
        .eq('user_id', userId)
        .is('ended_at', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!active || error || !data) return
      sessionRef.current = data
      setSession(data)
    })()
    return () => { active = false }
  }, [userId])

  useEffect(() => {
    const activity = () => {
      lastActivityRef.current = Date.now()
      if (document.visibilityState === 'visible' && document.hasFocus()) {
        stateRef.current = 'focused'
        setStatus('focused')
      }
    }
    const recalc = () => {
      const next = browserState(lastActivityRef.current)
      stateRef.current = next
      setStatus(next)
    }
    const events = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'scroll']
    events.forEach((event) => window.addEventListener(event, activity, { passive: true }))
    window.addEventListener('focus', activity)
    window.addEventListener('blur', recalc)
    document.addEventListener('visibilitychange', recalc)
    const stateTimer = window.setInterval(recalc, 2_000)
    const heartbeatTimer = window.setInterval(() => {
      if (sessionRef.current) heartbeat().catch((error) => console.warn('[wavo-work] heartbeat', error))
    }, HEARTBEAT_MS)
    const clockTimer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => {
      events.forEach((event) => window.removeEventListener(event, activity))
      window.removeEventListener('focus', activity)
      window.removeEventListener('blur', recalc)
      document.removeEventListener('visibilitychange', recalc)
      window.clearInterval(stateTimer)
      window.clearInterval(heartbeatTimer)
      window.clearInterval(clockTimer)
    }
  }, [heartbeat])

  async function startWorking() {
    if (busy) return
    setBusy(true)
    try {
      lastActivityRef.current = Date.now()
      const next = browserState(lastActivityRef.current)
      const { data, error } = await supabase.rpc('start_employee_work_session')
      if (error) throw error
      stateRef.current = next
      setStatus(next)
      sessionRef.current = data
      setSession(data)
      setNow(Date.now())
    } catch (error) {
      console.error('[wavo-work] start', error)
    } finally {
      setBusy(false)
    }
  }

  async function stopWorking() {
    if (busy || !sessionRef.current) return
    setBusy(true)
    try {
      await heartbeat(stateRef.current, true)
      sessionRef.current = null
      setSession(null)
    } catch (error) {
      console.error('[wavo-work] stop', error)
    } finally {
      setBusy(false)
    }
  }

  if (!session) {
    return (
      <button className="employee-work-start" onClick={startWorking} disabled={busy}>
        <Play size={14} /> {busy ? 'Starting…' : 'Start working'}
      </button>
    )
  }

  return (
    <div className="employee-work-control employee-work-running">
      <span className={`employee-work-state state-${status}`}><i /> {status}</span>
      <strong className="employee-work-clock">{exactClock(sessionSeconds(session, now))}</strong>
      <button className="employee-work-stop" onClick={stopWorking} disabled={busy}>
        <Square size={13} /> {busy ? 'Stopping…' : 'Stop'}
      </button>
    </div>
  )
}

function WorkLogModal({ me, onClose }) {
  const [users, setUsers] = useState([])
  const [sessions, setSessions] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now())

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data: profileRows, error: profileError } = await supabase
        .from('profiles')
        .select('id,username,is_employee,is_admin')
        .order('username', { ascending: true })
      if (profileError) throw profileError
      const { data: sessionRows, error: sessionError } = await supabase
        .from('employee_work_sessions')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(1000)
      if (sessionError) throw sessionError
      setUsers(profileRows || [])
      setSessions(sessionRows || [])
      setNow(Date.now())
    } catch (loadError) {
      console.error('[wavo-work] admin load', loadError)
      setError(loadError?.message || 'Could not load work records')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const tick = window.setInterval(() => setNow(Date.now()), 1_000)
    const refresh = window.setInterval(() => void load(), 15_000)
    return () => {
      window.clearInterval(tick)
      window.clearInterval(refresh)
    }
  }, [load])

  const rows = useMemo(() => users.map((user) => {
    const mine = sessions.filter((row) => row.user_id === user.id)
    const worked = mine.reduce((sum, row) => sum + sessionSeconds(row, now), 0)
    const focused = mine.reduce((sum, row) => sum + (row.focused_seconds || 0), 0)
    const idle = mine.reduce((sum, row) => sum + (row.idle_seconds || 0), 0)
    const away = mine.reduce((sum, row) => sum + (row.away_seconds || 0), 0)
    const tracked = focused + idle + away
    return {
      ...user,
      sessions: mine,
      worked,
      focused,
      idle,
      away,
      focusPercent: tracked ? Math.round((focused / tracked) * 100) : 0,
      active: mine.find((row) => !row.ended_at) || null,
    }
  }), [users, sessions, now])

  const filtered = rows.filter((row) => row.username?.toLowerCase().includes(search.trim().toLowerCase()))
  const employees = rows.filter((row) => row.is_employee)

  async function toggleEmployee(user) {
    const next = !user.is_employee
    const { error: updateError } = await supabase.from('profiles').update({ is_employee: next }).eq('id', user.id)
    if (updateError) {
      setError(updateError.message)
      return
    }
    await supabase.from('admin_actions').insert({
      actor_id: me.id,
      action: next ? 'promote_employee' : 'remove_employee',
      target_user_id: user.id,
      detail: next ? 'Employee work tracking enabled' : 'Employee work tracking disabled',
    })
    await load()
  }

  return createPortal(
    <div className="employee-work-modal-layer" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="employee-work-admin" role="dialog" aria-modal="true" aria-label="Employee work log">
        <header className="employee-work-admin-head">
          <div>
            <span>WAVO QA</span>
            <h2><BriefcaseBusiness size={21} /> Employee work log</h2>
            <p>Work time is Start → Stop. Focus data only describes the Wavo window.</p>
          </div>
          <div className="employee-work-admin-head-actions">
            <button onClick={load} disabled={loading} aria-label="Refresh work log"><RefreshCw size={17} /></button>
            <button onClick={onClose} aria-label="Close work log"><X size={19} /></button>
          </div>
        </header>

        <div className="employee-work-summary">
          <div><Users size={18} /><strong>{employees.length}</strong><span>Employees</span></div>
          <div><Clock3 size={18} /><strong>{employees.reduce((sum, row) => sum + row.worked, 0) ? formatDuration(employees.reduce((sum, row) => sum + row.worked, 0)) : '0s'}</strong><span>Total work</span></div>
        </div>

        <div className="employee-work-search">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search users…" />
          <span>{loading ? 'Refreshing…' : `${sessions.length} sessions`}</span>
        </div>

        {error && <div className="employee-work-admin-error">{error}</div>}

        <div className="employee-work-table">
          {filtered.map((user) => (
            <article key={user.id} className={`employee-work-user ${user.active ? 'is-working' : ''} ${user.is_employee ? 'is-employee' : ''}`}>
              <div className="employee-work-user-main">
                <div className="employee-work-avatar">{(user.username?.[0] || '?').toUpperCase()}</div>
                <div>
                  <strong>{user.username}{user.active && <span className="employee-work-live-tag">working</span>}{user.is_employee && <span className="employee-work-role-tag">employee</span>}</strong>
                  <span>{user.sessions.length} session{user.sessions.length === 1 ? '' : 's'}</span>
                </div>
              </div>
              <div className="employee-work-metrics">
                <div><strong>{formatDuration(user.worked)}</strong><span>worked</span></div>
                <div><strong>{formatDuration(user.focused)}</strong><span>focused</span></div>
                <div><strong>{formatDuration(user.idle)}</strong><span>idle</span></div>
                <div><strong>{formatDuration(user.away)}</strong><span>away</span></div>
                <div><strong>{user.focusPercent}%</strong><span>focus</span></div>
              </div>
              <button className={user.is_employee ? 'employee-work-remove' : 'employee-work-add'} onClick={() => toggleEmployee(user)}>
                {user.is_employee ? <><UserMinus size={15} /> Remove employee</> : <><UserCheck size={15} /> Make employee</>}
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>,
    document.body,
  )
}

export default function EmployeeWorkTrackingV3() {
  const [profile, setProfile] = useState(null)
  const [adminOpen, setAdminOpen] = useState(false)

  const loadProfile = useCallback(async (explicitUserId = null) => {
    const userId = explicitUserId || readStoredUserId()
    if (!userId) return false
    const { data, error } = await supabase
      .from('profiles')
      .select('id,username,is_employee,is_admin')
      .eq('id', userId)
      .maybeSingle()
    if (error) {
      console.warn('[wavo-work] profile load', error)
      return false
    }
    setProfile(data || null)
    return Boolean(data)
  }, [])

  useEffect(() => {
    let cancelled = false
    let attempts = 0

    const tryStoredProfile = async () => {
      if (cancelled) return
      attempts += 1
      const loaded = await loadProfile()
      if (!loaded && attempts < 12 && !cancelled) window.setTimeout(tryStoredProfile, 750)
    }

    void tryStoredProfile()

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const userId = session?.user?.id
      window.setTimeout(() => {
        if (!cancelled && userId) void loadProfile(userId)
        if (!cancelled && !userId) setProfile(null)
      }, 0)
    })

    return () => {
      cancelled = true
      listener.subscription.unsubscribe()
    }
  }, [loadProfile])

  if (!profile?.is_employee && !profile?.is_admin) return null

  return (
    <>
      <div className="employee-work-floating">
        <div className="employee-work-header-slot">
          {profile.is_employee && <EmployeeTimer userId={profile.id} />}
          {profile.is_admin && (
            <button className="employee-work-admin-button" onClick={() => setAdminOpen(true)}>
              <BriefcaseBusiness size={15} /> Work log
            </button>
          )}
        </div>
      </div>
      {adminOpen && <WorkLogModal me={profile} onClose={() => setAdminOpen(false)} />}
    </>
  )
}
