import { getPlatform, isNativeApp } from './platform'

export const MOBILE_BREAKPOINT = 760

let stableViewportHeight = 0

export function getUiMode() {
  if (isNativeApp) return 'mobile-app'
  if (typeof window === 'undefined') return 'desktop-web'
  return window.innerWidth <= MOBILE_BREAKPOINT ? 'mobile-web' : 'desktop-web'
}

export function isMobileApp() {
  return getUiMode() === 'mobile-app'
}

export function isMobileWeb() {
  return getUiMode() === 'mobile-web'
}

export function isDesktopWeb() {
  return getUiMode() === 'desktop-web'
}

export function isCompactUi() {
  return getUiMode() !== 'desktop-web'
}

function applyViewportVars(root) {
  if (typeof window === 'undefined') return

  const vv = window.visualViewport
  const visualWidth = Math.round(vv?.width || window.innerWidth || 0)
  const visualHeight = Math.round(vv?.height || window.innerHeight || 0)
  const innerHeight = Math.round(window.innerHeight || visualHeight || 0)
  const offsetTop = Math.max(0, Math.round(vv?.offsetTop || 0))

  // WKWebView's screen.height can include native space that the web view cannot
  // actually draw into. Using it as the app height makes the bottom navigation
  // stop above the real bottom edge and leaves a large empty strip underneath.
  // visualViewport/innerHeight describe the drawable CSS viewport instead.
  const visibleViewportHeight = Math.max(1, visualHeight + offsetTop)
  const currentViewportHeight = Math.max(visibleViewportHeight, innerHeight)

  if (!stableViewportHeight) stableViewportHeight = currentViewportHeight

  const keyboardOverlap = Math.max(0, stableViewportHeight - visibleViewportHeight)
  const keyboardOpen = keyboardOverlap > 120

  if (!keyboardOpen) {
    stableViewportHeight = currentViewportHeight
  }

  // When the keyboard is open, follow the visual viewport so composers sit
  // immediately above it. Otherwise, own exactly the drawable app viewport.
  const height = keyboardOpen ? visibleViewportHeight : currentViewportHeight
  const keyboard = keyboardOpen ? keyboardOverlap : 0

  root.style.setProperty('--wavo-viewport-width', `${visualWidth}px`)
  root.style.setProperty('--wavo-viewport-height', `${height}px`)
  root.style.setProperty('--wavo-keyboard-height', `${keyboard}px`)
  root.dataset.wavoKeyboard = keyboardOpen ? 'open' : 'closed'
}

export function applyUiMode() {
  if (typeof document === 'undefined') return getUiMode()

  const root = document.documentElement
  const mode = getUiMode()
  const platform = getPlatform()

  root.dataset.wavoUi = mode
  root.dataset.wavoPlatform = platform
  root.dataset.wavoNative = isNativeApp ? 'true' : 'false'
  root.classList.toggle('wavo-desktop-web', mode === 'desktop-web')
  root.classList.toggle('wavo-mobile-web', mode === 'mobile-web')
  root.classList.toggle('wavo-mobile-app', mode === 'mobile-app')
  root.classList.toggle('wavo-compact-ui', mode !== 'desktop-web')
  root.classList.toggle('wavo-native-app', isNativeApp)

  applyViewportVars(root)

  window.__WAVO_UI_MODE__ = mode
  window.__WAVO_PLATFORM__ = platform
  window.dispatchEvent(new CustomEvent('wavo:ui-mode', { detail: { mode, platform } }))
  return mode
}

export function installUiMode() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}

  const mobileQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`)
  const update = () => applyUiMode()

  applyUiMode()
  mobileQuery.addEventListener?.('change', update)
  window.addEventListener('resize', update, { passive: true })
  window.addEventListener('orientationchange', update, { passive: true })
  window.visualViewport?.addEventListener('resize', update, { passive: true })
  window.visualViewport?.addEventListener('scroll', update, { passive: true })

  return () => {
    mobileQuery.removeEventListener?.('change', update)
    window.removeEventListener('resize', update)
    window.removeEventListener('orientationchange', update)
    window.visualViewport?.removeEventListener('resize', update)
    window.visualViewport?.removeEventListener('scroll', update)
  }
}
