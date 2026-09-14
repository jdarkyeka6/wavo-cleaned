import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BriefcaseBusiness, Clock3, Play, RefreshCw, Square, UserCheck, UserMinus, Users, X } from 'lucide-react'
import { supabase } from './supabaseClient'
import './employee-work.css'

const IDLE_AFTER_MS = 60_000
const HEARTBEAT_MS = 10_000

function readCachedProfile() {
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i)
      if (!key || !key.startsWith('wavo:offline:v2:') || !key.endsWith(':app')) continue
      const raw = window.localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw)
      const profile = parsed?.data?.profile
      if (profile?.id && profile?.username) return profile
    }
  } catch (error) {
    console.warn('[wavo-work] cached profile read failed', error)
  }
  return null
}

function readStoredUserId() {
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i)
      if (!key || !key.startsWith('sb-') || !key.endsWith('-auth-token')) continue
      const raw = window.localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw)
      const id = parsed?.user?.id || parsed?.currentSession?.user?.id || parsed?.session?.user?.id
      if (id) return id
    }
  } catch (error) {
    console.warn('[wavo-work] stored auth read failed', error)
  }
  return null
}

function usernameFromPage() {
  const heading = document.querySelector('.hero-card h1')?.textContent?.trim() || ''
  const match = /^Hey\s+(.+?)\.$/i.exec(heading)
  if (!match) return null
  const value = match[1].trim()
  return value && value.toLowerCase() !== 'there' ? value : null
}

function exactClock(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0))
  const h = Math.floor(value / 3600)
  const m = Math.floor((value % 3600) / 60)
  const s = value % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatDuration(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0))
  const h = Math.floor(value / 3600)
  const m = Math.floor((value % 3600) / 60)
  const s = value % 60
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${s}s`
}

function sessionSeconds(session, now = Date.now()) {
  if (!session?.started_at) return 0
  const start = new Date(session.started_at).getTime()
  const end = session.ended_at ? new Date(session.ended_at).getTime() : now
  return Math.max(0, Math.floor((end - start) / 1000))
}

function currentBrowserState(lastActivityAt) {
  if (document.visibilityState !== 'visible' || !document.hasFocus()) return 'away'
  if (Date.now() - lastActivityAt >= IDLE_AFTER_MS) return 'idle'
  return 'focused'
}

function EmployeeTimer({ userId }) {
  const [session, setSession] = useState(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('focused')
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState('')
  const sessionRef = useRef(null)
  const stateRef = useRef('focused')
  const lastActivityRef = useRef(Date.now())

  useEffect(() => { sessionRef.current = session }, [session])

  const writeState = useCallback(async (stop = false) => {
    const id = sessionRef.current?.id
    if (!id) return
    const rpc = stop ? 'stop_employee_work_session' : 'record_employee_work_heartbeat'
    const { data, error: rpcError } = await supabase.rpc(rpc, { p_session_id: id, p_state: stateRef.current })
    if (rpcError) throw rpcError
    if (data && !stop) {
      sessionRef.current = data
      setSession(data)
    }
  }, [])

  useEffect(() => {
    let alive = true
    supabase.from('employee_work_sessions').select('*').eq('user_id', userId).is('ended_at', null)
      .order('started_at', { ascending: false }).limit(1).maybeSingle()
      .then(({ data, error: loadError }) => {
        if (!alive || loadError || !data) return
        sessionRef.current = data
        setSession(data)
      })
    return () => { alive = false }
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
      const next = currentBrowserState(lastActivityRef.current)
      stateRef.current = next
      setStatus(next)
    }
    const events = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'scroll']
    events.forEach((name) => window.addEventListener(name, activity, { passive: true }))
    window.addEventListener('focus', activity)
    window.addEventListener('blur', recalc)
    document.addEventListener('visibilitychange', recalc)
    const stateTimer = window.setInterval(recalc, 2_000)
    const heartbeatTimer = window.setInterval(() => {
      if (sessionRef.current) writeState().catch((err) => console.warn('[wavo-work] heartbeat', err))
    }, HEARTBEAT_MS)
    const clockTimer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => {
      events.forEach((name) => window.removeEventListener(name, activity))
      window.removeEventListener('focus', activity)
      window.removeEventListener('blur', recalc)
      document.removeEventListener('visibilitychange', recalc)
      window.clearInterval(stateTimer)
      window.clearInterval(heartbeatTimer)
      window.clearInterval(clockTimer)
    }
  }, [writeState])

  async function startWorking() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      lastActivityRef.current = Date.now()
      stateRef.current = currentBrowserState(lastActivityRef.current)
      setStatus(stateRef.current)
      const { data, error: startError } = await supabase.rpc('start_employee_work_session')
      if (startError) throw startError
      sessionRef.current = data
      setSession(data)
      setNow(Date.now())
    } catch (err) {
      console.error('[wavo-work] start', err)
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
      await writeState(true)
      sessionRef.current = null
      setSession(null)
    } catch (err) {
      console.error('[wavo-work] stop', err)
      setError('Could not stop work timer')
    } finally {
      setBusy(false)
    }
  }

  if (!session) {
    return <div className="employee-work-control"><button className="employee-work-start" onClick={startWorking} disabled={busy}><Play size={14} /> {busy ? 'Starting…' : 'Start working'}</button>{error && <span className="employee-work-error">{error}</span>}</div>
  }

  return <div className="employee-work-control employee-work-running"><span className={`employee-work-state state-${status}`}><i /> {status}</span><strong className="employee-work-clock">{exactClock(sessionSeconds(session, now))}</strong><button className="employee-work-stop" onClick={stopWorking} disabled={busy}><Square size={13} /> {busy ? 'Stopping…' : 'Stop'}</button>{error && <span className="employee-work-error">{error}</span>}</div>
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
      const [{ data: profileRows, error: profileError }, { data: sessionRows, error: sessionError }] = await Promise.all([
        supabase.from('profiles').select('id,username,is_employee,is_admin').order('username', { ascending: true }),
        supabase.from('employee_work_sessions').select('*').order('started_at', { ascending: false }).limit(1000),
      ])
      if (profileError) throw profileError
      if (sessionError) throw sessionError
      setUsers(profileRows || [])
      setSessions(sessionRows || [])
      setNow(Date.now())
    } catch (err) {
      console.error('[wavo-work] admin load', err)
      setError(err?.message || 'Could not load work records')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const tick = window.setInterval(() => setNow(Date.now()), 1_000)
    const refresh = window.setInterval(() => void load(), 15_000)
    return () => { window.clearInterval(tick); window.clearInterval(refresh) }
  }, [load])

  const rows = useMemo(() => users.map((user) => {
    const mine = sessions.filter((row) => row.user_id === user.id)
    const worked = mine.reduce((sum, row) => sum + sessionSeconds(row, now), 0)
    const focused = mine.reduce((sum, row) => sum + (row.focused_seconds || 0), 0)
    const idle = mine.reduce((sum, row) => sum + (row.idle_seconds || 0), 0)
    const away = mine.reduce((sum, row) => sum + (row.away_seconds || 0), 0)
    const tracked = focused + idle + away
    return { ...user, sessions: mine, worked, focused, idle, away, focusPercent: tracked ? Math.round((focused / tracked) * 100) : 0, active: mine.find((row) => !row.ended_at) || null }
  }), [users, sessions, now])

  const filtered = rows.filter((row) => row.username?.toLowerCase().includes(search.trim().toLowerCase()))
  const employees = rows.filter((row) => row.is_employee)

  async function toggleEmployee(user) {
    const next = !user.is_employee
    const { error: updateError } = await supabase.from('profiles').update({ is_employee: next }).eq('id', user.id)
    if (updateError) return setError(updateError.message)
    await supabase.from('admin_actions').insert({ actor_id: me.id, action: next ? 'promote_employee' : 'remove_employee', target_user_id: user.id, detail: next ? 'Employee work tracking enabled' : 'Employee work tracking disabled' })
    await load()
  }

  return createPortal(<div className="employee-work-modal-layer" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="employee-work-admin" role="dialog" aria-modal="true" aria-label="Employee work log"><header className="employee-work-admin-head"><div><span>WAVO QA</span><h2><BriefcaseBusiness size={21} /> Employee work log</h2><p>Work time is Start → Stop. Focus data only describes the Wavo window.</p></div><div className="employee-work-admin-head-actions"><button onClick={load} disabled={loading} aria-label="Refresh work log"><RefreshCw size={17} /></button><button onClick={onClose} aria-label="Close work log"><X size={19} /></button></div></header><div className="employee-work-summary"><div><Users size={18} /><strong>{employees.length}</strong><span>Employees</span></div><div><Clock3 size={18} /><strong>{formatDuration(employees.reduce((sum, row) => sum + row.worked, 0))}</strong><span>Total work</span></div></div><div className="employee-work-search"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search users…" /><span>{loading ? 'Refreshing…' : `${sessions.length} sessions`}</span></div>{error && <div className="employee-work-admin-error">{error}</div>}<div className="employee-work-table">{filtered.map((user) => <article key={user.id} className={`employee-work-user ${user.active ? 'is-working' : ''} ${user.is_employee ? 'is-employee' : ''}`}><div className="employee-work-user-main"><div className="employee-work-avatar">{(user.username?.[0] || '?').toUpperCase()}</div><div><strong>{user.username}{user.active && <span className="employee-work-live-tag">working</span>}{user.is_employee && <span className="employee-work-role-tag">employee</span>}</strong><span>{user.sessions.length} session{user.sessions.length === 1 ? '' : 's'}</span></div></div><div className="employee-work-metrics"><div><strong>{formatDuration(user.worked)}</strong><span>worked</span></div><div><strong>{formatDuration(user.focused)}</strong><span>focused</span></div><div><strong>{formatDuration(user.idle)}</strong><span>idle</span></div><div><strong>{formatDuration(user.away)}</strong><span>away</span></div><div><strong>{user.focusPercent}%</strong><span>focus</span></div></div><button className={user.is_employee ? 'employee-work-remove' : 'employee-work-add'} onClick={() => toggleEmployee(user)}>{user.is_employee ? <><UserMinus size={15} /> Remove employee</> : <><UserCheck size={15} /> Make employee</>}</button></article>)}</div></section></div>, document.body)
}

export default function EmployeeWorkTrackingV4() {
  const [profile, setProfile] = useState(() => readCachedProfile())
  const [adminOpen, setAdminOpen] = useState(false)

  const resolveProfile = useCallback(async (explicitUserId = null) => {
    const cached = readCachedProfile()
    if (cached?.id) {
      setProfile(cached)
      return true
    }

    const userId = explicitUserId || readStoredUserId()
    if (userId) {
      const { data, error } = await supabase.from('profiles').select('id,username,is_employee,is_admin').eq('id', userId).maybeSingle()
      if (!error && data) {
        setProfile(data)
        return true
      }
    }

    const username = usernameFromPage()
    if (username) {
      const { data, error } = await supabase.from('profiles').select('id,username,is_employee,is_admin').ilike('username', username).limit(1).maybeSingle()
      if (!error && data) {
        setProfile(data)
        return true
      }
    }
    return false
  }, [])

  useEffect(() => {
    let cancelled = false
    let attempts = 0
    let timer = null

    const tryResolve = async () => {
      if (cancelled) return
      attempts += 1
      const ok = await resolveProfile()
      if (!ok && attempts < 30 && !cancelled) timer = window.setTimeout(tryResolve, 500)
    }

    void tryResolve()
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const id = session?.user?.id
      window.setTimeout(() => {
        if (!cancelled && id) void resolveProfile(id)
      }, 0)
    })

    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
      listener.subscription.unsubscribe()
    }
  }, [resolveProfile])

  if (!profile?.is_employee && !profile?.is_admin) return null

  return <><div className="employee-work-floating"><div className="employee-work-header-slot">{profile.is_employee && <EmployeeTimer userId={profile.id} />}{profile.is_admin && <button className="employee-work-admin-button" onClick={() => setAdminOpen(true)}><BriefcaseBusiness size={15} /> Work log</button>}</div></div>{adminOpen && <WorkLogModal me={profile} onClose={() => setAdminOpen(false)} />}</>
}
