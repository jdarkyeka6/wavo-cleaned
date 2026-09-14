import { Component, Suspense, lazy, useEffect, useState } from 'react'

const EmployeeWorkTracking = lazy(() => import('./EmployeeWorkTrackingV3.jsx'))

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

  useEffect(() => {
    let timer = null
    let idle = null
    let cancelled = false

    const start = () => {
      // Employee tracking is an enhancement, never a boot dependency.
      // Give Wavo's existing auth/app startup first priority, then load it
      // as a separate chunk during an idle moment.
      timer = window.setTimeout(() => {
        if (cancelled) return
        if ('requestIdleCallback' in window) {
          idle = window.requestIdleCallback(() => {
            if (!cancelled) setReady(true)
          }, { timeout: 2000 })
        } else {
          setReady(true)
        }
      }, 1200)
    }

    if (document.readyState === 'complete') start()
    else window.addEventListener('load', start, { once: true })

    return () => {
      cancelled = true
      window.removeEventListener('load', start)
      if (timer !== null) window.clearTimeout(timer)
      if (idle !== null && 'cancelIdleCallback' in window) window.cancelIdleCallback(idle)
    }
  }, [])

  if (!ready) return null

  return (
    <EmployeeTrackerBoundary>
      <Suspense fallback={null}>
        <EmployeeWorkTracking />
      </Suspense>
    </EmployeeTrackerBoundary>
  )
}
