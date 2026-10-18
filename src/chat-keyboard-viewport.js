import { applyUiMode } from './lib/layout'

const INSTALL_KEY = '__WAVO_CHAT_KEYBOARD_VIEWPORT_INSTALLED__'

if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window[INSTALL_KEY]) {
  window[INSTALL_KEY] = true
  let frame = 0

  const measure = () => {
    frame = 0
    // Layout and keyboard geometry now come from the same visualViewport
    // reading; never calculate or subtract a second keyboard height here.
    applyUiMode()
  }

  const scheduleMeasure = () => {
    if (frame) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(measure)
  }

  const settleAfterFocus = () => {
    scheduleMeasure()
    setTimeout(scheduleMeasure, 80)
    setTimeout(scheduleMeasure, 280)
    setTimeout(scheduleMeasure, 500)
  }

  document.addEventListener('focusin', settleAfterFocus, true)
  document.addEventListener('focusout', settleAfterFocus, true)
  window.addEventListener('orientationchange', settleAfterFocus, { passive: true })

  // Do NOT force window.scrollTo(0, 0) while the keyboard animates.
  // In WKWebView that can pan the page and strand the input far above the keys.
  scheduleMeasure()
}
