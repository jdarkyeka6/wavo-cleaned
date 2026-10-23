// Watch conversation navigation immediately, with a low-frequency fallback
// for legacy views that don't yet emit the navigation event.
export function watchConversationChanges(target, resolve, options = {}) {
  const {
    intervalMs = 30000,
    startInterval = setInterval,
    stopInterval = clearInterval,
  } = options

  const onConversationChange = () => { void resolve() }
  target.addEventListener('wavo:conversation-change', onConversationChange)
  const timer = startInterval(onConversationChange, intervalMs)

  return () => {
    stopInterval(timer)
    target.removeEventListener('wavo:conversation-change', onConversationChange)
  }
}
