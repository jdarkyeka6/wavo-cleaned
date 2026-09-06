const INSTALL_KEY = '__WAVO_CHAT_SCROLL_ANCHOR_INSTALLED__'

if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window[INSTALL_KEY]) {
  window[INSTALL_KEY] = true

  const SELECTOR = '.chat-screen .dm-messages, .chat-screen .space-messages'
  const PIN_THRESHOLD = 120
  const USER_SCROLL_WINDOW_MS = 700
  const active = new Set()

  const distanceFromBottom = (el) =>
    Math.max(0, el.scrollHeight - el.clientHeight - el.scrollTop)

  function attach(el) {
    if (!(el instanceof HTMLElement) || el.dataset.wavoScrollAnchor === '1') return
    el.dataset.wavoScrollAnchor = '1'

    const state = {
      el,
      pinned: true,
      userScrollUntil: 0,
      frame: 0,
      mutationObserver: null,
      resizeObserver: null,
      destroyed: false,
    }

    const markUserScroll = () => {
      state.userScrollUntil = Date.now() + USER_SCROLL_WINDOW_MS
    }

    const scrollToBottom = () => {
      if (state.destroyed || !state.pinned) return
      if (state.frame) cancelAnimationFrame(state.frame)
      state.frame = requestAnimationFrame(() => {
        state.frame = 0
        if (state.destroyed || !state.pinned) return
        el.scrollTop = el.scrollHeight
      })
    }

    const onScroll = () => {
      const distance = distanceFromBottom(el)
      const userIsScrolling = Date.now() < state.userScrollUntil

      if (userIsScrolling) {
        state.pinned = distance <= PIN_THRESHOLD
        return
      }

      // If Wavo/React/layout code unexpectedly throws a chat that was pinned at
      // the bottom back toward the top, immediately restore the bottom instead
      // of treating that programmatic jump as user intent.
      if (state.pinned && distance > PIN_THRESHOLD) {
        scrollToBottom()
      } else if (distance <= PIN_THRESHOLD) {
        state.pinned = true
      }
    }

    el.addEventListener('wheel', markUserScroll, { passive: true })
    el.addEventListener('touchstart', markUserScroll, { passive: true })
    el.addEventListener('pointerdown', markUserScroll, { passive: true })
    el.addEventListener('scroll', onScroll, { passive: true })

    state.mutationObserver = new MutationObserver(() => {
      if (!state.pinned) return
      scrollToBottom()
      // A second frame catches late text/image/layout measurement after React
      // inserts a new message.
      requestAnimationFrame(scrollToBottom)
    })
    state.mutationObserver.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    })

    if ('ResizeObserver' in window) {
      state.resizeObserver = new ResizeObserver(() => {
        if (state.pinned) scrollToBottom()
      })
      state.resizeObserver.observe(el)
    }

    state.destroy = () => {
      state.destroyed = true
      if (state.frame) cancelAnimationFrame(state.frame)
      state.mutationObserver?.disconnect()
      state.resizeObserver?.disconnect()
      el.removeEventListener('wheel', markUserScroll)
      el.removeEventListener('touchstart', markUserScroll)
      el.removeEventListener('pointerdown', markUserScroll)
      el.removeEventListener('scroll', onScroll)
      delete el.dataset.wavoScrollAnchor
    }

    active.add(state)

    // Opening a conversation should land on the newest message, not message #1.
    scrollToBottom()
    requestAnimationFrame(scrollToBottom)
    setTimeout(scrollToBottom, 60)
  }

  function sync() {
    document.querySelectorAll(SELECTOR).forEach(attach)

    for (const state of active) {
      if (!state.el.isConnected) {
        state.destroy()
        active.delete(state)
      }
    }
  }

  const rootObserver = new MutationObserver(sync)

  const start = () => {
    sync()
    if (document.body) {
      rootObserver.observe(document.body, { childList: true, subtree: true })
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }
}
