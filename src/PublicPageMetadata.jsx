import { useLocation } from 'react-router-dom'
import { isNativeApp } from './lib/platform'

const PUBLIC_PAGES = {
  '/': "Wavo — your group chat can't make a plan",
  '/signup': 'Create an account — Wavo',
  '/login': 'Log in — Wavo',
  '/support': 'Support — Wavo',
}

// React 19 hoists these tags into <head> and removes them on route changes.
// Only known public pages get a canonical; private routes remain untouched.
export default function PublicPageMetadata() {
  const { pathname } = useLocation()
  const path = pathname.replace(/\/+$/, '') || '/'
  if (isNativeApp || !Object.hasOwn(PUBLIC_PAGES, path)) return null
  return <>
    <title>{PUBLIC_PAGES[path]}</title>
    <link rel="canonical" href={`https://wavo.lol${path}`} />
  </>
}
