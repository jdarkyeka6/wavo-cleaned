import { useEffect, useState } from 'react'
import { Bell, X } from 'lucide-react'
import { supabase } from './supabaseClient'
import {
  ensureNotificationPermission,
  pushSupported,
  registerForPush,
  registerServiceWorker,
  registerVoipForPush,
} from './push'
import { isNativeApp, isIOS } from './lib/platform'
import './notification-setup.css'

const DISMISSED_KEY = 'wavo_notification_prompt_dismissed'
const PUSH_DISABLED_KEY = 'wavo_push_disabled'
const PUSH_TOKEN_KEY = 'wavo_push_device_token'
const LAST_WEB_REFRESH_KEY = 'wavo_web_push_last_refresh'
const WEB_REFRESH_MS = 6 * 60 * 60 * 1000

function isDesktopWeb() {
  if (isNativeApp || typeof window === 'undefined') return false
  return window.matchMedia?.('(pointer: fine)').matches && window.innerWidth >= 700
}

function safeNotificationUrl(value) {
  return typeof value === 'string' && value.startsWith('/') ? value : null
}

export default function NotificationSetup() {
  const [userId, setUserId] = useState(null)
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    let mounted = true

    supabase.auth.getUser().then(({ data }) => {
      if (mounted) setUserId(data.user?.id ?? null)
    })

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null)
    })

    return () => {
      mounted = false
      authListener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!userId || !pushSupported()) return

    let cancelled = false
    let cleanup

    async function refreshWebPush(force = false) {
      if (isNativeApp || Notification.permission !== 'granted') return
      if (localStorage.getItem(PUSH_DISABLED_KEY) === '1') return

      const lastRefresh = Number(localStorage.getItem(LAST_WEB_REFRESH_KEY) || 0)
      if (!force && Date.now() - lastRefresh < WEB_REFRESH_MS) return

      await registerServiceWorker()
      const subscription = await registerForPush(userId)
      if (subscription) localStorage.setItem(LAST_WEB_REFRESH_KEY, String(Date.now()))
    }

    async function initialisePush() {
      const deliberatelyDisabled = localStorage.getItem(PUSH_DISABLED_KEY) === '1'

      if (isNativeApp && isIOS()) {
        // CallKit uses its own PushKit token. Register it regardless of normal
        // alert-notification permission so incoming calls can use the native
        // iOS calling UI instead of a delayed notification banner.
        await registerVoipForPush(userId)

        const { PushNotifications } = await import('@capacitor/push-notifications')
        const permission = await PushNotifications.checkPermissions()

        if (permission.receive === 'granted' && !deliberatelyDisabled) {
          const token = await registerForPush(userId)
          if (token) localStorage.setItem(PUSH_TOKEN_KEY, token)
        } else if (
          permission.receive !== 'denied' &&
          !deliberatelyDisabled &&
          localStorage.getItem(DISMISSED_KEY) !== '1' &&
          !cancelled
        ) {
          setVisible(true)
        }

        const actionListener = await PushNotifications.addListener(
          'pushNotificationActionPerformed',
          ({ notification }) => {
            const url = safeNotificationUrl(notification?.data?.url)
            if (url) window.location.assign(url)
          },
        )

        const receivedListener = await PushNotifications.addListener(
          'pushNotificationReceived',
          (notification) => {
            setToast({
              title: notification.title || 'Wavo',
              body: notification.body || '',
            })
            window.setTimeout(() => setToast(null), 4500)
          },
        )

        return () => {
          actionListener.remove()
          receivedListener.remove()
        }
      }

      // Desktop web previously only subscribed users who had already granted
      // browser permission, which meant many desktop users were never actually
      // offered push. Ask through Wavo's own card first, then let the browser
      // permission prompt happen only after the user clicks Turn on.
      await registerServiceWorker()

      if (!deliberatelyDisabled && Notification.permission === 'granted') {
        await refreshWebPush(true)
      } else if (
        Notification.permission === 'default' &&
        !deliberatelyDisabled &&
        localStorage.getItem(DISMISSED_KEY) !== '1' &&
        isDesktopWeb() &&
        !cancelled
      ) {
        setVisible(true)
      }

      const onVisibility = () => {
        if (document.visibilityState === 'visible') refreshWebPush().catch(() => {})
      }
      const onFocus = () => refreshWebPush().catch(() => {})
      const onServiceWorkerMessage = (event) => {
        if (event.data?.type !== 'notification-click') return
        const url = safeNotificationUrl(event.data?.url)
        if (url) window.location.assign(url)
      }

      document.addEventListener('visibilitychange', onVisibility)
      window.addEventListener('focus', onFocus)
      navigator.serviceWorker?.addEventListener('message', onServiceWorkerMessage)

      return () => {
        document.removeEventListener('visibilitychange', onVisibility)
        window.removeEventListener('focus', onFocus)
        navigator.serviceWorker?.removeEventListener('message', onServiceWorkerMessage)
      }
    }

    initialisePush().then((fn) => {
      cleanup = fn
    })

    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [userId])

  async function enableNotifications() {
    if (!userId || busy) return
    setBusy(true)
    try {
      if (!isNativeApp) await registerServiceWorker()
      const granted = await ensureNotificationPermission()
      if (!granted) {
        setVisible(false)
        return
      }
      const token = await registerForPush(userId)
      if (token) {
        if (typeof token === 'string') localStorage.setItem(PUSH_TOKEN_KEY, token)
        if (!isNativeApp) localStorage.setItem(LAST_WEB_REFRESH_KEY, String(Date.now()))
        localStorage.removeItem(PUSH_DISABLED_KEY)
        localStorage.removeItem(DISMISSED_KEY)
        setVisible(false)
        setToast({
          title: 'Notifications are on',
          body: isDesktopWeb()
            ? 'Desktop alerts are live, even when Wavo is in another tab.'
            : 'Wavo can now alert you about new messages.',
        })
        window.setTimeout(() => setToast(null), 3500)
      }
    } finally {
      setBusy(false)
    }
  }

  function dismissPrompt() {
    localStorage.setItem(DISMISSED_KEY, '1')
    setVisible(false)
  }

  if (!visible && !toast) return null

  return (
    <>
      {visible && (
        <div className="wavo-notification-card" role="dialog" aria-label="Enable notifications">
          <button
            className="wavo-notification-close"
            type="button"
            aria-label="Not now"
            onClick={dismissPrompt}
          >
            <X size={18} />
          </button>
          <div className="wavo-notification-icon" aria-hidden="true">
            <Bell size={22} />
          </div>
          <div className="wavo-notification-copy">
            <strong>{isDesktopWeb() ? 'Turn on desktop notifications' : 'Don’t miss the wave'}</strong>
            <span>
              {isDesktopWeb()
                ? 'Get instant message alerts while Wavo is hidden, minimised, or in another tab.'
                : 'Get notified when someone messages you, even when Wavo is closed.'}
            </span>
          </div>
          <button
            className="wavo-notification-enable"
            type="button"
            onClick={enableNotifications}
            disabled={busy}
          >
            {busy ? 'Turning on…' : 'Turn on'}
          </button>
        </div>
      )}

      {toast && (
        <button
          type="button"
          className="wavo-push-toast"
          onClick={() => setToast(null)}
          aria-label="Dismiss notification"
        >
          <Bell size={18} />
          <span>
            <strong>{toast.title}</strong>
            {toast.body && <small>{toast.body}</small>}
          </span>
        </button>
      )}
    </>
  )
}
