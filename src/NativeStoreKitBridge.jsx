import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from './supabaseClient'
import { isNativeIOS, reconcileApplePurchases } from './storePurchases'

const HOST_ATTR = 'data-wavo-native-storekit-disclosure'

export default function NativeStoreKitBridge() {
  const [host, setHost] = useState(null)
  const native = isNativeIOS()

  useEffect(() => {
    if (!native) return undefined
    let active = true

    const reconcile = async (session) => {
      if (!active || !session?.user?.id) return
      try {
        await reconcileApplePurchases()
      } catch (error) {
        console.warn('[wavo] Apple entitlement reconciliation skipped', error)
      }
    }

    supabase.auth.getSession().then(({ data }) => reconcile(data?.session || null))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      void reconcile(session || null)
    })

    return () => {
      active = false
      listener?.subscription?.unsubscribe()
    }
  }, [native])

  useEffect(() => {
    if (!native) return undefined

    const sync = () => {
      const hub = document.querySelector('.wpp-hub')
      const plans = hub?.querySelector('.wpp-plans')
      if (!hub || !plans) {
        setHost((current) => (current ? null : current))
        return
      }

      let nextHost = hub.querySelector(`[${HOST_ATTR}]`)
      if (!nextHost) {
        nextHost = document.createElement('div')
        nextHost.setAttribute(HOST_ATTR, '')
        plans.after(nextHost)
      }
      setHost((current) => (current === nextHost ? current : nextHost))
    }

    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [native])

  if (!native || !host) return null

  return createPortal(
    <div className="wavo-iap-disclosure">
      <strong>Monthly auto-renewable subscriptions</strong>
      <p>
        Wavo Premium, Plus and Pro renew monthly until cancelled. Payment is charged to your Apple ID when you confirm the purchase.
      </p>
      <p>
        Use Restore Purchases for an existing Apple purchase, or Manage Subscription to view or cancel your subscription. Paid access remains available through the period already paid for.
      </p>
      <p>
        <a href="/terms.html">Terms of Use</a> · <a href="/privacy.html">Privacy Policy</a>
      </p>
    </div>,
    host,
  )
}
