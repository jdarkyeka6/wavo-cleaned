import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Crown } from 'lucide-react'
import { supabase } from './supabaseClient'
import { PLANS } from './lib/pricing'
import { isNativeApp } from './lib/platform'
import { startWebCheckout } from './storePurchases'
import './black-plan.css'

const HOST_ATTR = 'data-wavo-black-plan-host'

function premiumIsActive(profile) {
  if (!profile?.is_premium) return false
  return !profile.premium_until || new Date(profile.premium_until) > new Date()
}

function patchWebProCard(isBlack) {
  if (isNativeApp) return
  const cards = [...document.querySelectorAll('.wpp-plan')]
  const proCard = cards.find((card) => card.querySelector('.wpp-plan-title strong')?.textContent?.trim().toLowerCase() === 'pro')
  if (proCard) {
    const price = proCard.querySelector('.wpp-plan-title small')
    if (price && price.textContent !== 'A$19.99/month') price.textContent = 'A$19.99/month'

    if (isBlack) {
      proCard.classList.remove('current')
      const current = proCard.querySelector('.wpp-plan-title em')
      if (current) current.textContent = 'Included'
    }
  }

  if (isBlack) {
    const studioTitle = document.querySelector('.wpp-hero h2')
    if (studioTitle?.textContent?.trim() === 'Wavo Pro') studioTitle.textContent = 'Wavo Black'

    const profileHero = document.querySelector('.profile-hero')
    if (profileHero) {
      profileHero.classList.add('wavo-black-member')
      if (!profileHero.querySelector('.wavo-black-member-badge')) {
        const badge = document.createElement('span')
        badge.className = 'wavo-black-member-badge'
        badge.textContent = 'WAVO BLACK'
        profileHero.appendChild(badge)
      }
    }
  } else {
    document.querySelectorAll('.profile-hero.wavo-black-member').forEach((node) => node.classList.remove('wavo-black-member'))
    document.querySelectorAll('.wavo-black-member-badge').forEach((node) => node.remove())
  }
}

export default function BlackPlanEnhancement() {
  const [host, setHost] = useState(null)
  const [profile, setProfile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const activePaid = useMemo(() => premiumIsActive(profile), [profile])
  const isBlack = activePaid && String(profile?.entitlement_source || '').toLowerCase() === 'stripe_black'
  const blockedByCurrentPlan = activePaid && !isBlack

  useEffect(() => {
    if (isNativeApp) return undefined

    const sync = () => {
      const plans = document.querySelector('.wpp-plans')
      if (!plans) {
        setHost((current) => current?.isConnected ? current : null)
        return
      }
      let next = plans.querySelector(`[${HOST_ATTR}]`)
      if (!next) {
        next = document.createElement('div')
        next.setAttribute(HOST_ATTR, '')
        next.className = 'wavo-black-plan-host'
        plans.appendChild(next)
      }
      setHost((current) => current === next ? current : next)
    }

    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (isNativeApp) return undefined
    let alive = true

    async function load(nextSession) {
      const userId = nextSession?.user?.id
      if (!userId) {
        if (alive) setProfile(null)
        return
      }
      const { data, error } = await supabase
        .from('profiles')
        .select('id,is_premium,premium_until,tier,entitlement_source')
        .eq('id', userId)
        .single()
      if (!alive) return
      if (error) {
        console.error('[wavo black] profile', error)
        setProfile(null)
        return
      }
      setProfile(data)
    }

    supabase.auth.getSession().then(({ data }) => load(data.session || null))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => load(session || null))
    return () => {
      alive = false
      listener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (isNativeApp) return undefined
    let queued = false
    const apply = () => {
      queued = false
      patchWebProCard(isBlack)
    }
    const schedule = () => {
      if (queued) return
      queued = true
      requestAnimationFrame(apply)
    }
    schedule()
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [isBlack])

  async function buyBlack() {
    if (busy || blockedByCurrentPlan || isBlack) return
    setBusy(true)
    setNotice('')
    try {
      await startWebCheckout('black')
    } catch (error) {
      setNotice(error?.message || 'Wavo Black checkout could not start.')
      setBusy(false)
    }
  }

  if (isNativeApp || !host) return null

  const black = PLANS.black
  const features = [
    'Everything in Wavo Pro',
    'Exclusive Black member profile treatment',
    'Black membership status in Profile Studio',
    'Top Wavo supporter membership',
    'Future Black-only visual drops when released',
  ]

  return createPortal(
    <article className={`wpp-plan wavo-black-plan ${isBlack ? 'current' : ''}`}>
      <div className="wpp-plan-title">
        <span className="wavo-black-icon"><Crown size={18}/></span>
        <div><strong>Black</strong><small>A${black.price.toFixed(2)}/month</small></div>
        {isBlack && <em>Current</em>}
      </div>
      <p className="wavo-black-copy">The luxury supporter tier. Normal Wavo stays normal-priced; Black is for people who want the top membership.</p>
      <div className="wpp-feature-list">
        {features.map((feature) => <span key={feature}><Check size={14}/>{feature}</span>)}
      </div>
      {isBlack ? (
        <div className="wpp-plan-included">Wavo Black is active</div>
      ) : blockedByCurrentPlan ? (
        <div className="wpp-plan-included">Available after your current paid period ends</div>
      ) : (
        <button type="button" disabled={busy} onClick={buyBlack}>{busy ? 'Opening…' : 'Get Wavo Black'}</button>
      )}
      {notice && <small className="wavo-black-note" role="status">{notice}</small>}
    </article>,
    host,
  )
}
