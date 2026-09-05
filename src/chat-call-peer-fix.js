// ChatMotionCalls reads the chat header to find the peer. When no nickname is
// configured, the secondary line contains a status rather than @username.
// Swap it only for the duration of the click dispatch so the call starter gets
// the real username without changing the visible chat header.

if (typeof document !== 'undefined') {
  document.addEventListener('click', (event) => {
    const button = event.target?.closest?.('.wavo-video-call-button')
    if (!button) return

    const topbar = button.closest('.chat-topbar')
    const info = topbar
      ? Array.from(topbar.children).find((node) => node.tagName === 'DIV' && !node.classList.contains('avatar'))
      : null
    const secondary = info?.querySelector('span')
    const primary = info?.querySelector('strong')?.textContent?.trim()
    if (!secondary || !primary || secondary.textContent.trim().startsWith('@')) return

    const original = secondary.textContent
    secondary.textContent = `@${primary.replace(/^@/, '')}`
    queueMicrotask(() => {
      if (secondary.isConnected) secondary.textContent = original
    })
  }, true)
}
