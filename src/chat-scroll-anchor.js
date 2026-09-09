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
      settleTimers: [],
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

    const onScroll = () => {
      const distance = distanceFromBottom(el)
      const userIsScrolling = Date.now() < state.userScrollUntil

      if (userIsScrolling) {
        state.pinned = distance <= PIN_THRESHOLD
        return
      }

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

    state.mutationObserver = new MutationObserver((records) => {
      const conversationWasReplaced = records.some((record) =>
        record.type === 'childList' && record.removedNodes.length > 0 && record.addedNodes.length > 0
      )

      if (conversationWasReplaced) {
        settleAtBottom()
        return
      }

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
      el.removeEventListener('wheel', markUserScroll)
      el.removeEventListener('touchstart', markUserScroll)
      el.removeEventListener('pointerdown', markUserScroll)
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
