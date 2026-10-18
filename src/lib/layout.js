import { getPlatform, isNativeApp } from './platform'
import { measureViewportGeometry } from './viewportGeometry'

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

let lastLayoutWidth = 0

function applyViewportVars(root) {
  if (typeof window === 'undefined') return

  const vv = window.visualViewport
  const visualWidth = Math.max(1, Math.round(vv?.width || window.innerWidth || 0))
  const layoutWidth = Math.max(1, Math.round(window.innerWidth || visualWidth))
  const visualHeight = vv?.height || window.innerHeight
  const innerHeight = window.innerHeight
  const visualOffsetTop = vv?.offsetTop || 0

  // A portrait/landscape change needs a new full-height baseline. Ordinary
  // keyboard animation never changes the layout width this dramatically.
  if (lastLayoutWidth && Math.abs(layoutWidth - lastLayoutWidth) > 100) {
    stableViewportHeight = 0
  }
  lastLayoutWidth = layoutWidth

  const geometry = measureViewportGeometry({
    visualHeight,
    innerHeight,
    visualOffsetTop,
    previousFullHeight: stableViewportHeight,
    hasVisualViewport: Boolean(vv),
  })
  stableViewportHeight = geometry.fullHeight

  const focused = document.activeElement
  const composerFocused = focused instanceof HTMLElement &&
    focused.matches('input, textarea, [contenteditable="true"]') &&
    Boolean(focused.closest('.chat-screen .composer, .space-conversation-screen .composer'))

  root.style.setProperty('--wavo-viewport-width', `${visualWidth}px`)
  root.style.setProperty('--wavo-viewport-height', `${geometry.viewportHeight}px`)
  root.style.setProperty('--wavo-keyboard-height', `${geometry.keyboardHeight}px`)
  root.style.setProperty('--wavo-chat-visible-top', `${geometry.visibleTop}px`)
  root.style.setProperty('--wavo-chat-visible-height', `${geometry.viewportHeight}px`)
  root.dataset.wavoKeyboard = geometry.keyboardOpen ? 'open' : 'closed'
  root.dataset.wavoChatKeyboard = geometry.keyboardOpen && composerFocused ? 'open' : 'closed'
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
