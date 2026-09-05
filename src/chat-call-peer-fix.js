// ChatMotionCalls reads the first <span> in the DM identity block as the
// canonical username. The normal Wavo header uses that span for presence text
// (for example "Wavo friend") when no nickname is set, so calls could end up
// looking for a user literally named "Wavo friend".
//
// Keep the visible header exactly as-is, but insert an invisible @username as
// the first span whenever the visible secondary line is presence/status text.
// A MutationObserver keeps this correct as React mounts and switches chats.

function syncCallPeerIdentity() {
  const topbars = document.querySelectorAll('.chat-topbar')

  for (const topbar of topbars) {
    const info = Array.from(topbar.children).find(
      (node) => node.tagName === 'DIV' && !node.classList.contains('avatar'),
    )
    if (!info) continue

    const primary = info.querySelector('strong')?.textContent?.trim()
    const spans = Array.from(info.querySelectorAll('span'))
    const visibleSecondary = spans.find(
      (span) => !span.classList.contains('wavo-call-peer-username'),
    )
    if (!primary || !visibleSecondary) continue

    const existing = info.querySelector('.wavo-call-peer-username')

    // With a nickname, App already renders @realusername as the visible
    // secondary line. Do not interfere with that path.
    if (visibleSecondary.textContent.trim().startsWith('@')) {
      existing?.remove()
      continue
    }

    let canonical = existing
    if (!canonical) {
      canonical = document.createElement('span')
      canonical.className = 'wavo-call-peer-username'
      canonical.hidden = true
      canonical.setAttribute('aria-hidden', 'true')
      info.insertBefore(canonical, visibleSecondary)
    }

    const username = primary.replace(/^@/, '')
    const next = `@${username}`
    if (canonical.textContent !== next) canonical.textContent = next
  }
}

if (typeof document !== 'undefined') {
  let queued = false
  const scheduleSync = () => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      syncCallPeerIdentity()
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleSync, { once: true })
  } else {
    scheduleSync()
  }

  const observer = new MutationObserver(scheduleSync)
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  })
}
