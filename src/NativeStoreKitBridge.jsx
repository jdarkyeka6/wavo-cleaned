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
    <div style={{ margin: '12px 0 18px', padding: '12px 14px', borderRadius: 14, background: 'rgba(255,255,255,.04)', fontSize: 12, lineHeight: 1.5 }}>
      <strong>Monthly auto-renewable subscriptions</strong>
      <p style={{ margin: '6px 0' }}>
        Premium, Plus and Pro renew each month unless cancelled. Your Apple ID is charged through the App Store. You can restore purchases or manage/cancel your subscription from the controls on this screen.
      </p>
      <p style={{ margin: 0 }}>
        <a href="/terms.html">Terms of Service</a> · <a href="/privacy.html">Privacy Policy</a>
      </p>
    </div>,
    host,
  )
}
