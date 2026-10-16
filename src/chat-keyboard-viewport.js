const INSTALL_KEY = '__WAVO_CHAT_KEYBOARD_VIEWPORT_INSTALLED__'

if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window[INSTALL_KEY]) {
  window[INSTALL_KEY] = true

  const root = document.documentElement
  let baselineHeight = Math.round(window.visualViewport?.height || window.innerHeight || 0)
  let frame = 0

  const isChatComposerFocus = (node) => {
    if (!(node instanceof HTMLElement)) return false
    if (!node.matches('input, textarea, [contenteditable="true"]')) return false
    return Boolean(node.closest('.chat-screen .composer, .space-conversation-screen .composer'))
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

    // The native WKWebView has one real visible rectangle above the keyboard.
    // Give the chat shell that exact rectangle, rather than relying on 100dvh,
    // innerHeight, or a separately computed keyboard subtraction.
    root.style.setProperty('--wavo-chat-visible-top', `${offsetTop}px`)
    root.style.setProperty('--wavo-chat-visible-height', `${height}px`)
    root.dataset.wavoChatKeyboard = keyboardOpen ? 'open' : 'closed'

    // Do not call window.scrollTo here. On recent iOS versions, the native
    // keyboard pans visualViewport and forcing a window scroll makes the
    // entire chat jump while the keyboard animates.
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
