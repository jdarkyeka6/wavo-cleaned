const INSTALL_KEY = '__WAVO_CHAT_KEYBOARD_VIEWPORT_INSTALLED__'

if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window[INSTALL_KEY]) {
  window[INSTALL_KEY] = true

  const root = document.documentElement
  let baselineHeight = Math.round(window.visualViewport?.height || window.innerHeight || 0)
  let frame = 0

  const isChatComposerFocus = (node) => {
    if (!(node instanceof HTMLElement)) return false
    if (!node.matches('input, textarea, [contenteditable="true"]')) return false
    return Boolean(node.closest('.chat-screen .composer'))
  }

  const measure = () => {
    frame = 0
    const viewport = window.visualViewport
    const height = Math.round(viewport?.height || window.innerHeight || 0)
    const focused = isChatComposerFocus(document.activeElement)

    // Keep the largest settled viewport as the no-keyboard baseline. This avoids
    // treating ordinary tiny viewport changes as a keyboard opening.
    if (!focused && height > baselineHeight) baselineHeight = height

    const keyboardShrink = Math.max(0, baselineHeight - height)
    const keyboardOpen = focused && keyboardShrink > 80
    const offsetTop = keyboardOpen ? Math.max(0, Math.round(viewport?.offsetTop || 0)) : 0

    root.style.setProperty('--wavo-chat-viewport-offset-top', `${offsetTop}px`)
    root.dataset.wavoChatKeyboard = keyboardOpen ? 'open' : 'closed'

    // The chat itself owns scrolling. iOS should never leave the document
    // scrolled after it pans the visual viewport to reveal the composer.
    if (keyboardOpen && (window.scrollX !== 0 || window.scrollY !== 0)) {
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
    setTimeout(scheduleMeasure, 280)
  }

  const resetForOrientation = () => {
    baselineHeight = 0
    setTimeout(() => {
      baselineHeight = Math.round(window.visualViewport?.height || window.innerHeight || 0)
      scheduleMeasure()
    }, 320)
  }

  document.addEventListener('focusin', settleAfterFocus, true)
  document.addEventListener('focusout', settleAfterFocus, true)
  window.addEventListener('resize', scheduleMeasure, { passive: true })
  window.addEventListener('orientationchange', resetForOrientation, { passive: true })
  window.visualViewport?.addEventListener('resize', scheduleMeasure, { passive: true })
  window.visualViewport?.addEventListener('scroll', scheduleMeasure, { passive: true })

  scheduleMeasure()
}
