import { Component, Suspense, lazy, useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

const EmployeeWorkTracking = lazy(() => import('./EmployeeWorkTrackingV4.jsx'))

function findCachedProfile() {
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i)
      if (!key || !key.startsWith('wavo:offline:v2:') || !key.endsWith(':app')) continue
      const raw = window.localStorage.getItem(key)
      if (!raw) continue
      const envelope = JSON.parse(raw)
      const profile = envelope?.data?.profile
      if (profile?.id) return { key, envelope, profile }
    }
  } catch (error) {
    console.warn('[wavo-work] cached profile scan failed', error)
  }
  return null
}

function cacheHasRoleFlags(profile) {
  return typeof profile?.is_admin === 'boolean' && typeof profile?.is_employee === 'boolean'
}

async function refreshCachedRoleFlags(cached) {
  if (!cached?.profile?.id) return false

  const { data, error } = await supabase
    .from('profiles')
    .select('id,username,is_admin,is_employee')
    .eq('id', cached.profile.id)
    .maybeSingle()

  if (error || !data) {
    if (error) console.warn('[wavo-work] role refresh failed', error)
    return false
  }

  try {
    const nextEnvelope = {
      ...cached.envelope,
      data: {
        ...(cached.envelope?.data || {}),
        profile: {
          ...cached.profile,
          ...data,
        },
      },
    }
    window.localStorage.setItem(cached.key, JSON.stringify(nextEnvelope))
  } catch (error) {
    console.warn('[wavo-work] role cache update failed', error)
  }

  return true
}

class EmployeeTrackerBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error) {
    console.error('[wavo-work] tracker isolated after runtime error', error)
  }

  render() {
    if (this.state.failed) return null
    return this.props.children
  }
}

export default function EmployeeWorkTrackingSafe() {
  const [ready, setReady] = useState(false)
  const [roleCheckFailed, setRoleCheckFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let retryTimer = null
    let attempts = 0

    const prepare = async () => {
      if (cancelled) return
      attempts += 1

      const cached = findCachedProfile()
      if (!cached) {
        if (attempts < 20) retryTimer = window.setTimeout(prepare, 750)
        else setReady(true)
        return
      }

      // Old Wavo offline caches can predate the employee/admin columns. Never
      // let one of those stale rows decide that the controls should be hidden.
      if (cacheHasRoleFlags(cached.profile)) {
        setReady(true)
        return
      }

      const refreshed = await refreshCachedRoleFlags(cached)
      if (cancelled) return
      if (refreshed) {
        setReady(true)
        return
      }

      if (attempts < 20) {
        retryTimer = window.setTimeout(prepare, 750)
      } else {
        setRoleCheckFailed(true)
      }
    }

    const startTimer = window.setTimeout(prepare, 350)
    return () => {
      cancelled = true
      window.clearTimeout(startTimer)
      if (retryTimer) window.clearTimeout(retryTimer)
    }
  }, [])

  if (roleCheckFailed) {
    return <div style={{ position: 'fixed', top: 76, right: 16, zIndex: 5001, padding: '8px 10px', borderRadius: 10, background: 'rgba(82,24,34,.96)', color: '#ffd9df', fontSize: 11, fontWeight: 800 }}>Work tracker could not verify your role</div>
  }

  if (!ready) return null

  return (
    <EmployeeTrackerBoundary>
      <Suspense fallback={null}>
        <EmployeeWorkTracking />
      </Suspense>
    </EmployeeTrackerBoundary>
  )
}
