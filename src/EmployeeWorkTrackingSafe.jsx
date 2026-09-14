import { Component, Suspense, lazy, useEffect, useState } from 'react'

const EmployeeWorkTracking = lazy(() => import('./EmployeeWorkTrackingV4.jsx'))

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
    const timer = window.setTimeout(() => setReady(true), 500)
    return () => window.clearTimeout(timer)
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
