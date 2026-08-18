import { useEffect, useState } from 'react'
import { Bell, X } from 'lucide-react'
import { supabase } from './supabaseClient'
import {
  ensureNotificationPermission,
  pushSupported,
  registerForPush,
} from './push'
import { isNativeApp, isIOS } from './lib/platform'
import './notification-setup.css'

const DISMISSED_KEY = 'wavo_notification_prompt_dismissed'

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

    async function initialisePush() {
      if (isNativeApp && isIOS()) {
        const { PushNotifications } = await import('@capacitor/push-notifications')
        const permission = await PushNotifications.checkPermissions()

        if (permission.receive === 'granted') {
          await registerForPush(userId)
        } else if (
          permission.receive !== 'denied' &&
          localStorage.getItem(DISMISSED_KEY) !== '1' &&
          !cancelled
        ) {
          setVisible(true)
        }

        const actionListener = await PushNotifications.addListener(
          'pushNotificationActionPerformed',
          ({ notification }) => {
            const url = notification?.data?.url
            if (typeof url === 'string' && url.startsWith('/')) {
              window.location.assign(url)
            }
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

      // Web users who have already granted permission should quietly refresh
      // their subscription without showing another prompt.
      if ('Notification' in window && Notification.permission === 'granted') {
        await registerForPush(userId)
      }
    }

    let cleanup
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
      const granted = await ensureNotificationPermission()
      if (!granted) {
        setVisible(false)
        return
      }
      const token = await registerForPush(userId)
      if (token) {
        localStorage.removeItem(DISMISSED_KEY)
        setVisible(false)
        setToast({ title: 'Notifications are on', body: 'Wavo can now alert you about new messages.' })
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
            <strong>Don’t miss the wave</strong>
            <span>Get notified when someone messages you, even when Wavo is closed.</span>
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
