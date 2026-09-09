const INSTALL_KEY = '__WAVO_CHAT_SCROLL_ANCHOR_INSTALLED__'

if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window[INSTALL_KEY]) {
  window[INSTALL_KEY] = true

  const SELECTOR = '.chat-screen .dm-messages, .chat-screen .space-messages'
  const PIN_THRESHOLD = 120
  const active = new Set()

  const distanceFromBottom = (el) =>
    Math.max(0, el.scrollHeight - el.clientHeight - el.scrollTop)

  function attach(el) {
    if (!(el instanceof HTMLElement) || el.dataset.wavoScrollAnchor === '1') return
    el.dataset.wavoScrollAnchor = '1'

    const state = {
      el,
      pinned: true,
      frame: 0,
      settleTimers: [],
      mutationObserver: null,
      resizeObserver: null,
      destroyed: false,
    }

    const scrollToBottom = () => {
      if (state.destroyed || !state.pinned) return
      if (state.frame) cancelAnimationFrame(state.frame)
      state.frame = requestAnimationFrame(() => {
        state.frame = 0
        if (state.destroyed || !state.pinned) return
        el.scrollTo({ top: el.scrollHeight, left: 0, behavior: 'auto' })
      })
    }

    const settleAtBottom = () => {
      if (state.destroyed) return
      state.pinned = true
      scrollToBottom()
      requestAnimationFrame(scrollToBottom)
      state.settleTimers.forEach(clearTimeout)
      state.settleTimers = [40, 120, 300, 700, 1200].map((delay) => setTimeout(scrollToBottom, delay))
    }

    // User scrolling always wins. The old implementation only treated a touch or
    // pointer as "user scrolling" for 700 ms, then snapped the list back to the
    // bottom while the gesture was still moving. That made chats feel locked.
    // Instead, the current scroll position itself is the source of truth.
    const onScroll = () => {
      state.pinned = distanceFromBottom(el) <= PIN_THRESHOLD
    }

    el.addEventListener('scroll', onScroll, { passive: true })

    state.mutationObserver = new MutationObserver(() => {
      // Only follow new/changed content while the user is already near the
      // bottom. Never force a scrolled-up user back down.
      if (!state.pinned) return
      scrollToBottom()
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
      state.settleTimers.forEach(clearTimeout)
      state.mutationObserver?.disconnect()
      state.resizeObserver?.disconnect()
      el.removeEventListener('scroll', onScroll)
      delete el.dataset.wavoScrollAnchor
    }

    active.add(state)
    settleAtBottom()
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
