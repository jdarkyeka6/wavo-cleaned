// Pure destination parser so native notification URLs can be regression-tested
// without importing Capacitor, React, or requiring a browser global.
export function parsePushDestination(raw, origin) {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null

  let path
  try {
    const url = new URL(raw, origin)
    if (url.origin !== origin) return null
    path = url.pathname
  } catch {
    return null
  }

  if (path === '/chats' || path === '/inbox' || path === '/messages') return '/inbox'
  if (path.startsWith('/chats/')) path = '/chat/' + path.slice('/chats/'.length)

  if (path.startsWith('/chat/') && path.length > '/chat/'.length) return path
  if (path.startsWith('/space/') && path.length > '/space/'.length) return path
  return null
}
