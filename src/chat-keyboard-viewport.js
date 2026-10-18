import { applyUiMode } from './lib/layout'

const INSTALL_KEY = '__WAVO_CHAT_KEYBOARD_VIEWPORT_INSTALLED__'

if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window[INSTALL_KEY]) {
  window[INSTALL_KEY] = true
  let frame = 0

  // The layout module is the single source of truth for native resize, visual
  // viewport panning and keyboard state. Do not maintain another baseline here.
  const measure = () => {
    frame = 0
    applyUiMode()
    if (document.documentElement.dataset.wavoChatKeyboard === 'open' &&
        (window.scrollX !== 0 || window.scrollY !== 0)) {
      // Only the messages pane should scroll, not the document behind it.
      window.scrollTo(0, 0)
    }
  }

  const scheduleMeasure = () => {
    if (frame) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(measure)
  }

  const settleAfterFocus = () => {
    scheduleMeasure()
    setTimeout(scheduleMeasure, 80)
    setTimeout(scheduleMeasure, 300)
  }

  document.addEventListener('focusin', settleAfterFocus, true)
  document.addEventListener('focusout', settleAfterFocus, true)

  // These deferred measurements are important when iOS animates its keyboard:
  // visualViewport.resize can finish after the input's focus event.
  window.addEventListener('orientationchange', settleAfterFocus, { passive: true })
  scheduleMeasure()
}
