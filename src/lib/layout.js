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
  const visualHeight = Math.max(1, Math.round(vv?.height || window.innerHeight || 0))
  const innerHeight = Math.max(1, Math.round(window.innerHeight || visualHeight))
  const visualOffsetTop = Math.max(0, Math.round(vv?.offsetTop || 0))

  // On iOS, WKWebView can resize its layout viewport AND report a second,
  // smaller visual viewport while the keyboard animates. Using the latter
  // blindly subtracts the keyboard twice and leaves the composer floating
  // well above the keys. Keep a full-height baseline for this orientation.
  const fullHeight = Math.max(innerHeight, visualHeight + visualOffsetTop)
  if (!stableViewportHeight) stableViewportHeight = fullHeight

  const keyboardOpen = stableViewportHeight - Math.min(innerHeight, visualHeight) > 120
  const nativeLayoutResized = isNativeApp && stableViewportHeight - innerHeight > 120
  const height = keyboardOpen
    ? (nativeLayoutResized ? innerHeight : visualHeight)
    : fullHeight
  // Only a visual-viewport resize needs its pan offset compensated. When the
  // native WebView has already resized, applying that offset a second time
  // pushes the input away from the keyboard.
  const chatOffsetTop = keyboardOpen && !nativeLayoutResized ? visualOffsetTop : 0
  const keyboardHeight = keyboardOpen
    ? Math.max(0, stableViewportHeight - height - chatOffsetTop)
    : 0

  if (!keyboardOpen) stableViewportHeight = fullHeight

  const focused = document.activeElement
  const composerFocused = focused instanceof HTMLElement &&
    focused.matches('input, textarea, [contenteditable="true"]') &&
    Boolean(focused.closest('.chat-screen .composer, .space-conversation-screen .composer'))

  root.style.setProperty('--wavo-viewport-width', `${visualWidth}px`)
  root.style.setProperty('--wavo-viewport-height', `${height}px`)
  root.style.setProperty('--wavo-keyboard-height', `${keyboardHeight}px`)
  root.style.setProperty('--wavo-chat-viewport-offset-top', `${chatOffsetTop}px`)
  root.dataset.wavoKeyboard = keyboardOpen ? 'open' : 'closed'
  root.dataset.wavoChatKeyboard = keyboardOpen && composerFocused ? 'open' : 'closed'
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
