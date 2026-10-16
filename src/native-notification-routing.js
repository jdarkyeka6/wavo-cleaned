import { isIOS, isNativeApp } from './lib/platform'

// Register this at app boot, not after Supabase auth/push registration. A push
// tap can be delivered before the signed-in user is loaded on a cold launch.
const INSTALL_KEY = '__WAVO_NATIVE_PUSH_ROUTER_INSTALLED__'

export function normalizePushDestination(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null

  let path
  try {
    const url = new URL(raw, window.location.origin)
    if (url.origin !== window.location.origin) return null
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

function navigateToNotification(raw) {
  const destination = normalizePushDestination(raw)
  if (!destination) return

  // Never window.location.assign() in a Capacitor WebView: doing so tears down
  // the React app, may race Supabase auth, and can leave a blank native screen.
  if (window.location.pathname !== destination) {
    window.history.pushState(
      { ...(window.history.state || {}), wavoPlaceMarker: true },
      '',
      destination,
    )
  }

  // The existing place-markers navigation adapter restores the right chat
  // after the UI is mounted, even if the app was cold-launched.
  window.dispatchEvent(new Event('wavo:navigate-place'))
}

if (typeof window !== 'undefined' && isNativeApp && isIOS() && !window[INSTALL_KEY]) {
  window[INSTALL_KEY] = true
  import('@capacitor/push-notifications')
    .then(({ PushNotifications }) =>
      PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
        navigateToNotification(notification?.data?.url)
      }),
    )
    .catch((error) => {
      console.warn('[wavo] Native notification routing unavailable', error)
    })
}
