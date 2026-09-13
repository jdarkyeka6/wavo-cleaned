import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { CreditCard } from 'lucide-react'
import { supabase } from './supabaseClient'
import { isNativeApp } from './lib/platform'

const HOST_ATTR = 'data-wavo-subscription-management-host'

function premiumIsActive(profile) {
  if (!profile?.is_premium) return false
  return !profile.premium_until || new Date(profile.premium_until) > new Date()
}

function isStripeSubscription(profile) {
  if (!premiumIsActive(profile)) return false
  const source = String(profile?.entitlement_source || '').toLowerCase()
  return source === 'stripe' || source === 'stripe_plus'
}

function formatEndDate(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

export default function SubscriptionManagement() {
  const [host, setHost] = useState(null)
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (isNativeApp) return undefined

    const syncHost = () => {
      const profileHero = document.querySelector('.profile-hero')
      const profileScreen = profileHero?.closest('.screen')
      if (!profileScreen) {
        setHost((current) => (current ? null : current))
        return
      }

      let nextHost = profileScreen.querySelector(`[${HOST_ATTR}]`)
      if (!nextHost) {
        nextHost = document.createElement('div')
        nextHost.setAttribute(HOST_ATTR, '')
        const logoutButton = profileScreen.querySelector('.logout-button')
        if (logoutButton) profileScreen.insertBefore(nextHost, logoutButton)
        else profileScreen.appendChild(nextHost)
      }
      setHost((current) => (current === nextHost ? current : nextHost))
    }

    syncHost()
    const observer = new MutationObserver(syncHost)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (isNativeApp) return undefined
    let active = true

    async function loadProfile(nextSession) {
      if (!nextSession?.user?.id) {
        if (active) setProfile(null)
        return
      }
      const { data, error } = await supabase
        .from('profiles')
        .select('id,is_premium,premium_until,entitlement_source')
        .eq('id', nextSession.user.id)
        .single()
      if (!active) return
      if (error) {
        console.error('[wavo] subscription profile', error)
        setProfile(null)
        return
      }
      setProfile(data)
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      const nextSession = data.session || null
      setSession(nextSession)
      loadProfile(nextSession)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return
      setSession(nextSession || null)
      loadProfile(nextSession || null)
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  async function cancelRenewal() {
    if (busy) return
    const confirmed = window.confirm(
      'Cancel your Wavo subscription renewal? You will keep paid features until the end of the period you already paid for.',
    )
    if (!confirmed) return

    setBusy(true)
    setNotice('')
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token || session?.access_token
      if (!token) throw new Error('You are signed out. Sign in again and retry.')

      const response = await fetch('/api/cancel-subscription', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const raw = await response.text()
      let payload = null
      try { payload = JSON.parse(raw) } catch { /* non-JSON host error */ }
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || `Cancellation failed (${response.status}).`)
      }

      const endDate = formatEndDate(payload.currentPeriodEnd)
      if (payload.alreadyScheduled) {
        setNotice(endDate ? `Your subscription is already set to end on ${endDate}.` : 'Your subscription is already set not to renew.')
      } else {
        setNotice(endDate ? `Renewal cancelled. You keep Wavo paid features until ${endDate}.` : 'Renewal cancelled. You keep access through the paid period.')
      }
    } catch (error) {
      setNotice(error?.message || 'Could not cancel the subscription.')
    } finally {
      setBusy(false)
    }
  }

  if (isNativeApp || !host || !isStripeSubscription(profile)) return null

  return createPortal(
    <section className="settings-card" aria-label="Wavo subscription">
      <div className="settings-head">
        <CreditCard />
        <div>
          <strong>Subscription</strong>
          <span>Manage the Wavo plan you bought on the web.</span>
        </div>
      </div>
      {notice && <p role="status" aria-live="polite">{notice}</p>}
      <button className="secondary-btn danger-soft" type="button" onClick={cancelRenewal} disabled={busy}>
        {busy ? 'Cancelling…' : 'Cancel renewal'}
      </button>
      <small>You will not be charged again. Paid features stay active until your current billing period ends.</small>
    </section>,
    host,
  )
}
