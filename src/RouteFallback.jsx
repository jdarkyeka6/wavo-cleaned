import { Component } from 'react'
import { useLocation } from 'react-router-dom'
import { isAppPath } from './lib/appRoutes'

const wrap = { minHeight: '100dvh', background: '#14131f', color: '#f4f1ff', display: 'grid', placeItems: 'center', padding: 24, fontFamily: 'Outfit, system-ui, sans-serif', textAlign: 'center', boxSizing: 'border-box' }
const button = { display: 'inline-block', padding: '12px 20px', borderRadius: 12, background: '#7549ed', color: '#fff', textDecoration: 'none', border: 0, cursor: 'pointer', font: 'inherit', fontWeight: 600 }
function Fallback({ notFound = false }) {
  return <main style={wrap}>
    <div style={{ maxWidth: 460 }}>
      <img src="/favicon.svg" alt="Wavo" width="70" height="70" />
      <h1 style={{ fontSize: 'clamp(2rem,6vw,3.5rem)', margin: '20px 0 10px' }}>{notFound ? '404' : 'Wavo hit a snag'}</h1>
      <p style={{ fontSize: '1.25rem', margin: '0 0 10px' }}>{notFound ? 'Page not found' : 'This page could not load.'}</p>
      <p style={{ color: '#c2bdd2', lineHeight: 1.6 }}>{notFound ? 'This link may be incorrect or the page may have moved.' : 'Try reloading the page. Your account and saved messages are still on Wavo.'}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12, marginTop: 24 }}>
        {!notFound && <button style={button} onClick={() => window.location.reload()}>Try again</button>}
        <a style={button} href="/home">Back to Wavo</a>
        <a style={{ ...button, background: '#292638' }} href="/support">Get support</a>
      </div>
    </div>
  </main>
}

export function AppRoute({ children }) {
  const { pathname } = useLocation()
  return isAppPath(pathname) ? children : <Fallback notFound />
}

export class RouteErrorBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error, info) {
    console.error('[wavo] page rendering failed', error, info.componentStack)
  }
  render() {
    return this.state.failed ? <Fallback /> : this.props.children
  }
}
