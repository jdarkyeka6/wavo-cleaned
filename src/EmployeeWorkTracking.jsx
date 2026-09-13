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
const RESTORE_AWAY_AFTER_MS = 15_000

function formatDuration(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0))
  const hours = Math.floor(value / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  const secs = value % 60
  if (hours) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  if (minutes) return `${minutes}m ${String(secs).padStart(2, '0')}s`
  return `${secs}s`
}

function exactClock(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0))
  const hours = Math.floor(value / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  const secs = value % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

function sessionSeconds(session, now = Date.now()) {
  if (!session?.started_at) return 0
  const start = new Date(session.started_at).getTime()
  const end = session.ended_at ? new Date(session.ended_at).getTime() : now
  return Math.max(0, Math.floor((end - start) / 1000))
}

function browserWorkState(lastActivityAt) {
  if (typeof document === 'undefined') return 'away'
  if (document.visibilityState !== 'visible' || !document.hasFocus()) return 'away'
  if (Date.now() - lastActivityAt >= IDLE_AFTER_MS) return 'idle'
  return 'focused'
}

function useHeaderHost() {
  const [host, setHost] = useState(null)

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const findHost = () => setHost(document.querySelector('.app-header'))
    findHost()
    const observer = new MutationObserver(findHost)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  return host
}

function EmployeeTimer({ userId }) {
  const [session, setSession] = useState(null)
  const [status, setStatus] = useState('focused')
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState('')

  const sessionRef = useRef(null)
  const stateRef = useRef('focused')
  const lastActivityRef = useRef(Date.now())
  const writeQueueRef = useRef(Promise.resolve())

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  const writeInterval = useCallback((workState, stop = false, sessionId = null) => {
    const id = sessionId || sessionRef.current?.id
    if (!id) return Promise.resolve(null)

    const rpcName = stop ? 'stop_employee_work_session' : 'record_employee_work_heartbeat'
    writeQueueRef.current = writeQueueRef.current
      .catch(() => null)
      .then(async () => {
        const { data, error: rpcError } = await supabase.rpc(rpcName, {
          p_session_id: id,
          p_state: workState,
        })
        if (rpcError) throw rpcError
        if (data && sessionRef.current?.id === id) {
          sessionRef.current = data
          setSession(data)
        }
        return data
      })

    return writeQueueRef.current
  }, [])

  const transitionTo = useCallback((nextState) => {
    const previous = stateRef.current
    if (previous === nextState) return
    if (sessionRef.current) writeInterval(previous).catch(() => {})
    stateRef.current = nextState
    setStatus(nextState)
  }, [writeInterval])

  useEffect(() => {
    let cancelled = false

    async function restore() {
      const { data, error: loadError } = await supabase
        .from('employee_work_sessions')
        .select('*')
        .eq('user_id', userId)
        .is('ended_at', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (cancelled) return
      if (loadError) {
        console.error('[wavo-work] restore', loadError)
        setError('Work timer could not load')
        return
      }
      if (!data) return

      sessionRef.current = data
      setSession(data)

      const nextState = browserWorkState(lastActivityRef.current)
      const heartbeatAge = Date.now() - new Date(data.last_heartbeat_at).getTime()
      const restoreState = heartbeatAge > RESTORE_AWAY_AFTER_MS ? 'away' : nextState

      try {
        await writeInterval(restoreState, false, data.id)
      } catch (restoreError) {
        console.error('[wavo-work] restore heartbeat', restoreError)
      }

      stateRef.current = nextState
      setStatus(nextState)
    }

    restore()
    return () => { cancelled = true }
  }, [userId, writeInterval])

  useEffect(() => {
    const activityEvents = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'scroll']

    const markActivity = () => {
      lastActivityRef.current = Date.now()
      if (document.visibilityState === 'visible' && document.hasFocus() && stateRef.current === 'idle') {
        transitionTo('focused')
      }
    }

    const handleFocus = () => {
      lastActivityRef.current = Date.now()
      transitionTo('focused')
    }

    const handleBlur = () => transitionTo('away')

    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') transitionTo('away')
      else {
        lastActivityRef.current = Date.now()
        transitionTo(document.hasFocus() ? 'focused' : 'away')
      }
    }

    activityEvents.forEach((eventName) => window.addEventListener(eventName, markActivity, { passive: true }))
    window.addEventListener('focus', handleFocus)
    window.addEventListener('blur', handleBlur)
    document.addEventListener('visibilitychange', handleVisibility)

    const stateTimer = window.setInterval(() => {
      transitionTo(browserWorkState(lastActivityRef.current))
    }, 2_000)

    const heartbeatTimer = window.setInterval(() => {
      if (sessionRef.current) writeInterval(stateRef.current).catch((heartbeatError) => {
        console.error('[wavo-work] heartbeat', heartbeatError)
      })
    }, HEARTBEAT_MS)

    const clockTimer = window.setInterval(() => setNow(Date.now()), 1_000)

    return () => {
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, markActivity))
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('blur', handleBlur)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.clearInterval(stateTimer)
      window.clearInterval(heartbeatTimer)
      window.clearInterval(clockTimer)
    }
  }, [transitionTo, writeInterval])

  async function startWorking() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      lastActivityRef.current = Date.now()
      const nextState = browserWorkState(lastActivityRef.current)
      const { data, error: startError } = await supabase.rpc('start_employee_work_session')
      if (startError) throw startError
      sessionRef.current = data
      stateRef.current = nextState
      setStatus(nextState)
      setSession(data)
      setNow(Date.now())
    } catch (startError) {
      console.error('[wavo-work] start', startError)
      setError('Could not start work timer')
    } finally {
      setBusy(false)
    }
  }

  async function stopWorking() {
    if (busy || !sessionRef.current) return
    setBusy(true)
    setError('')
    try {
      await writeInterval(stateRef.current, true)
      sessionRef.current = null
      setSession(null)
    } catch (stopError) {
      console.error('[wavo-work] stop', stopError)
      setError('Could not stop work timer')
    } finally {
      setBusy(false)
    }
  }

  if (!session) {
    return (
      <div className="employee-work-control">
        <button
          className="employee-work-start"
          onClick={startWorking}
          disabled={busy}
          title="Start a Wavo work session. While running, Wavo records focused, idle and away time for this Wavo window."
        >
          <Play size={14} /> {busy ? 'Starting…' : 'Start working'}
        </button>
        {error && <span className="employee-work-error">{error}</span>}
      </div>
    )
  }

  return (
    <div className="employee-work-control employee-work-running" title="Wavo work tracking is on">
      <span className={`employee-work-state state-${status}`}>
        <i /> {status}
      </span>
      <strong className="employee-work-clock">{exactClock(sessionSeconds(session, now))}</strong>
      <button className="employee-work-stop" onClick={stopWorking} disabled={busy}>
        <Square size={13} /> {busy ? 'Stopping…' : 'Stop'}
      </button>
      {error && <span className="employee-work-error">{error}</span>}
    </div>
  )
}

function WorkAdminPanel({ onClose, me }) {
  const [users, setUsers] = useState([])
  const [sessions, setSessions] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data: profileRows, error: profileError } = await supabase
        .from('profiles')
        .select('id,username,is_employee,is_admin')
        .order('username', { ascending: true })
      if (profileError) throw profileError

      const allSessions = []
      const pageSize = 1000
      for (let from = 0; ; from += pageSize) {
        const { data: rows, error: sessionError } = await supabase
          .from('employee_work_sessions')
          .select('*')
          .order('started_at', { ascending: false })
          .range(from, from + pageSize - 1)
        if (sessionError) throw sessionError
        allSessions.push(...(rows || []))
        if (!rows || rows.length < pageSize) break
      }

      setUsers(profileRows || [])
      setSessions(allSessions)
      setNow(Date.now())
    } catch (loadError) {
      console.error('[wavo-work] admin load', loadError)
      setError(loadError?.message || 'Could not load work records')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const clock = window.setInterval(() => setNow(Date.now()), 1_000)
    const refresh = window.setInterval(load, 15_000)
    return () => {
      window.clearInterval(clock)
      window.clearInterval(refresh)
    }
  }, [load])

  const sessionByUser = useMemo(() => {
    const map = new Map()
    for (const row of sessions) {
      if (!map.has(row.user_id)) map.set(row.user_id, [])
      map.get(row.user_id).push(row)
    }
    return map
  }, [sessions])

  const employeeRows = useMemo(() => {
    return users
      .map((user) => {
        const rows = sessionByUser.get(user.id) || []
        const totalSeconds = rows.reduce((sum, row) => sum + sessionSeconds(row, now), 0)
        const focused = rows.reduce((sum, row) => sum + (row.focused_seconds || 0), 0)
        const idle = rows.reduce((sum, row) => sum + (row.idle_seconds || 0), 0)
        const away = rows.reduce((sum, row) => sum + (row.away_seconds || 0), 0)
        const tracked = focused + idle + away
        const active = rows.find((row) => !row.ended_at) || null
        return {
          ...user,
          rows,
          totalSeconds,
          focused,
          idle,
          away,
          focusPercent: tracked ? Math.round((focused / tracked) * 100) : 0,
          active,
        }
      })
      .sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)) || Number(b.is_employee) - Number(a.is_employee) || a.username.localeCompare(b.username))
  }, [users, sessionByUser, now])

  const visibleRows = employeeRows.filter((row) =>
    row.username?.toLowerCase().includes(search.trim().toLowerCase())
  )

  const employees = employeeRows.filter((row) => row.is_employee)
  const activeCount = employees.filter((row) => row.active).length
  const totalEmployeeSeconds = employees.reduce((sum, row) => sum + row.totalSeconds, 0)

  async function toggleEmployee(user) {
    const next = !user.is_employee
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ is_employee: next })
      .eq('id', user.id)

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
            <p>Work time is the Start → Stop clock. Focus data only describes the Wavo window.</p>
          </div>
          <div className="employee-work-admin-head-actions">
            <button onClick={load} disabled={loading} aria-label="Refresh work log"><RefreshCw size={17} /></button>
            <button onClick={onClose} aria-label="Close work log"><X size={19} /></button>
          </div>
        </header>

        <div className="employee-work-summary">
          <div><Users size={18} /><strong>{employees.length}</strong><span>Employees</span></div>
          <div><span className="work-live-dot" /><strong>{activeCount}</strong><span>Working now</span></div>
          <div><Clock3 size={18} /><strong>{formatDuration(totalEmployeeSeconds)}</strong><span>Total work</span></div>
        </div>

        <div className="employee-work-search">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search users…" />
          <span>{loading ? 'Refreshing…' : `${sessions.length} session${sessions.length === 1 ? '' : 's'}`}</span>
        </div>

        {error && <div className="employee-work-admin-error">{error}</div>}

        <div className="employee-work-table">
          {visibleRows.map((user) => (
            <article key={user.id} className={`employee-work-user ${user.active ? 'is-working' : ''} ${user.is_employee ? 'is-employee' : ''}`}>
              <div className="employee-work-user-main">
                <div className="employee-work-avatar">{(user.username?.[0] || '?').toUpperCase()}</div>
                <div>
                  <strong>
                    {user.username}
                    {user.active && <span className="employee-work-live-tag">working</span>}
                    {user.is_employee && <span className="employee-work-role-tag">employee</span>}
                  </strong>
                  <span>
                    {user.rows.length} session{user.rows.length === 1 ? '' : 's'}
                    {user.active ? ` · started ${new Date(user.active.started_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}
                  </span>
                </div>
              </div>

              <div className="employee-work-metrics">
                <div><strong>{formatDuration(user.totalSeconds)}</strong><span>worked</span></div>
                <div><strong>{formatDuration(user.focused)}</strong><span>focused</span></div>
                <div><strong>{formatDuration(user.idle)}</strong><span>idle</span></div>
                <div><strong>{formatDuration(user.away)}</strong><span>away</span></div>
                <div><strong>{user.focusPercent}%</strong><span>focus</span></div>
              </div>

              <button
                className={user.is_employee ? 'employee-work-remove' : 'employee-work-add'}
                onClick={() => toggleEmployee(user)}
              >
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

export default function EmployeeWorkTracking() {
  const [profile, setProfile] = useState(null)
  const [adminOpen, setAdminOpen] = useState(false)
  const headerHost = useHeaderHost()

  useEffect(() => {
    let mounted = true

    async function loadProfile() {
      const { data: authData } = await supabase.auth.getSession()
      const userId = authData?.session?.user?.id
      if (!userId) {
        if (mounted) setProfile(null)
        return
      }
      const { data } = await supabase
        .from('profiles')
        .select('id,username,is_employee,is_admin')
        .eq('id', userId)
        .maybeSingle()
      if (mounted) setProfile(data || null)
    }

    loadProfile()
    const profileRefresh = window.setInterval(loadProfile, 30_000)
    const { data: listener } = supabase.auth.onAuthStateChange(() => loadProfile())

    return () => {
      mounted = false
      window.clearInterval(profileRefresh)
      listener.subscription.unsubscribe()
    }
  }, [])

  if (!profile?.is_employee && !profile?.is_admin) return null

  const controls = (
    <div className="employee-work-header-slot">
      {profile.is_employee && <EmployeeTimer userId={profile.id} />}
      {profile.is_admin && (
        <button className="employee-work-admin-button" onClick={() => setAdminOpen(true)}>
          <BriefcaseBusiness size={15} /> Work log
        </button>
      )}
    </div>
  )

  return (
    <>
      {headerHost ? createPortal(controls, headerHost) : <div className="employee-work-floating">{controls}</div>}
      {adminOpen && <WorkAdminPanel me={profile} onClose={() => setAdminOpen(false)} />}
    </>
  )
}
