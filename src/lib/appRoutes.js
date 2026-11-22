// Keep the app shell's supported URLs explicit; unknown paths show a 404.
const simplePaths = new Set([
  '/', '/home', '/login', '/signup', '/inbox', '/messages', '/chat', '/chats',
  '/spaces', '/groups', '/space', '/profile', '/you', '/settings',
  '/subscriptions', '/plans', '/pricing',
])

export function isAppPath(pathname) {
  const path = pathname.replace(/\/+$/, '').toLowerCase() || '/'
  if (simplePaths.has(path)) return true
  return /^\/(?:chat|chats|space)\/[^/]+$/.test(path)
}
