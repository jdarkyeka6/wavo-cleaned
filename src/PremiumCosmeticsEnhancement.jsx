import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronUp, Crown, Palette, Sparkles, Star } from 'lucide-react'
import { supabase } from './supabaseClient'
import Premium from './Premium'
import { UserLabel } from './Cosmetic'
import { swatchStyle } from './lib/cosmeticStyles'
import { DEFAULT_PLAN, PLANS } from './lib/pricing'
import { isNativeApp } from './lib/platform'
import { useCosmetics } from './useCosmetics'
import './premium-cosmetics.css'

const HOST_ATTR = 'data-wavo-premium-cosmetics-host'
const THEME_KEY = 'wavo-theme'
const DEFAULT_THEME = 'dusk'
const NAME_SELECTORS = [
  '.wave-head > div > strong',
  '.friend-row > div > strong',
  '.profile-hero h1',
  '.space-message > span',
  '.chat-topbar > div > strong',
  '.attention-card > div > strong',
]

function premiumIsActive(profile) {
  if (!profile?.is_premium) return false
  return !profile.premium_until || new Date(profile.premium_until) > new Date()
}

function uniqueById(items) {
  const seen = new Set()
  return items.filter((item) => {
    if (!item || seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

function directText(node) {
  return [...node.childNodes]
    .filter((child) => child.nodeType === Node.TEXT_NODE)
    .map((child) => child.nodeValue || '')
    .join('')
    .trim()
}

export default function PremiumCosmeticsEnhancement() {
  const [host, setHost] = useState(null)
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || DEFAULT_THEME)
  const [showAllThemes, setShowAllThemes] = useState(false)
  const [showPremium, setShowPremium] = useState(false)
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [checkoutError, setCheckoutError] = useState('')
  const [notice, setNotice] = useState('')
  const visibleProfileCache = useRef(new Map())
  const decorateTimer = useRef(null)

  const userId = session?.user?.id || null
  const isPremium = premiumIsActive(profile)
  const tier = isPremium ? profile?.tier || 'premium' : 'free'
  const { catalogue, stats, claim, requirement, isUsable } = useCosmetics(userId, tier)

  const themeItems = useMemo(() => catalogue.filter((item) => item.kind === 'theme'), [catalogue])
  const badgeItems = useMemo(() => catalogue.filter((item) => item.kind === 'badge'), [catalogue])
  const nameItems = useMemo(() => catalogue.filter((item) => item.kind === 'name_style'), [catalogue])

  const featuredThemes = useMemo(() => {
    if (showAllThemes) return themeItems
    const selected = themeItems.find((item) => item.id === theme)
    return uniqueById([
      selected,
      ...themeItems.filter((item) => item.unlock_type === 'default').slice(0, 6),
      ...themeItems.filter((item) => item.unlock_type === 'premium').slice(0, 4),
      ...themeItems.filter((item) => item.unlock_type === 'earned').slice(0, 2),
    ]).slice(0, 12)
  }, [showAllThemes, themeItems, theme])

  async function refreshProfile(id = userId) {
    if (!id) {
      setProfile(null)
      return null
    }
    const { data, error } = await supabase.from('profiles').select('*').eq('id', id).single()
    if (error) {
      console.error('[wavo] cosmetics profile', error)
      return null
    }
    setProfile(data)
    if (data?.username) visibleProfileCache.current.set(data.username, data)
    return data
  }

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session || null)
      if (data.session?.user?.id) refreshProfile(data.session.user.id)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return
      setSession(next || null)
      if (next?.user?.id) refreshProfile(next.user.id)
      else setProfile(null)
    })
    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
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
        nextHost.className = 'wavo-premium-cosmetics-host'
        const supportHost = profileScreen.querySelector('[data-wavo-profile-support-host]')
        const logoutButton = profileScreen.querySelector('.logout-button')
        if (supportHost) profileScreen.insertBefore(nextHost, supportHost)
        else if (logoutButton) profileScreen.insertBefore(nextHost, logoutButton)
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
    document.documentElement.setAttribute('data-theme', theme || DEFAULT_THEME)
    localStorage.setItem(THEME_KEY, theme || DEFAULT_THEME)
  }, [theme])

  useEffect(() => {
    if (!themeItems.length) return
    const selected = themeItems.find((item) => item.id === theme)
    if (selected && !isUsable(selected)) {
      setTheme(DEFAULT_THEME)
      setNotice('That theme is locked on this account, so Wavo switched back to Warm Dusk.')
    }
  }, [themeItems, tier])

  useEffect(() => {
    const returned = new URLSearchParams(window.location.search).get('premium')
    if (!returned || !userId) return
    if (returned === '1') {
      setNotice('Payment returned to Wavo. Premium access is refreshing…')
      refreshProfile(userId).then((next) => {
        if (premiumIsActive(next)) setNotice('Premium is active. Your themes and name styles are unlocked.')
      })
    } else if (returned === '0') {
      setNotice('Premium checkout was cancelled.')
    }
  }, [userId])

  async function equip(item, slot) {
    if (!item || !userId) return
    if (!isUsable(item)) {
      const req = requirement(item)
      if (req?.kind === 'premium') {
        if (!isNativeApp) setShowPremium(true)
        return
      }
      if (req?.kind === 'earned' && req.met) {
        const claimed = await claim(item.id)
        if (!claimed) return
      } else return
    }

    const equipped = slot === 'badge' ? profile?.equipped_badge : profile?.equipped_name_style
    const next = equipped === item.id ? null : item.id
    const { data, error } = await supabase.rpc('equip_cosmetic', {
      p_cosmetic_id: next,
      p_slot: slot,
    })
    if (error || data === false) {
      setNotice(error?.message || 'That cosmetic could not be equipped.')
      return
    }
    await refreshProfile()
  }

  async function pickTheme(item) {
    if (!item) return
    if (isUsable(item)) {
      setTheme(item.id)
      return
    }
    const req = requirement(item)
    if (req?.kind === 'earned' && req.met) {
      const claimed = await claim(item.id)
      if (claimed) setTheme(item.id)
      return
    }
    if (req?.kind === 'premium' && !isNativeApp) setShowPremium(true)
  }

  async function startCheckout(plan) {
    if (isNativeApp) return
    const planId = typeof plan === 'string' && PLANS[plan] ? plan : DEFAULT_PLAN
    setCheckoutBusy(true)
    setCheckoutError('')
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) throw new Error('You are signed out. Sign in again and retry.')
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan: planId }),
      })
      const raw = await response.text()
      let payload = null
      try { payload = JSON.parse(raw) } catch { /* non-JSON host error */ }
      if (payload?.url) {
        window.location.href = payload.url
        return
      }
      throw new Error(payload?.error || `Checkout failed (${response.status}).`)
    } catch (error) {
      setCheckoutError(error?.message || 'Could not open checkout.')
    } finally {
      setCheckoutBusy(false)
    }
  }

  useEffect(() => {
    if (!catalogue.length) return
    let disposed = false

    const decorate = async () => {
      if (disposed) return
      const targets = [...document.querySelectorAll(NAME_SELECTORS.join(','))]
      if (!targets.length) return

      const names = targets.map((node) => directText(node) || node.dataset.wavoRawName || '').filter(Boolean)
      const unknown = [...new Set(names)].filter((name) => !visibleProfileCache.current.has(name))
      if (unknown.length) {
        const { data } = await supabase
          .from('profiles')
          .select('id,username,equipped_badge,equipped_name_style')
          .in('username', unknown.slice(0, 60))
        ;(data || []).forEach((row) => visibleProfileCache.current.set(row.username, row))
      }
      if (disposed) return

      const byId = Object.fromEntries(catalogue.map((item) => [item.id, item]))
      document.body.dataset.wavoCosmeticDecorating = '1'
      targets.forEach((node) => {
        const raw = directText(node) || node.dataset.wavoRawName || ''
        if (!raw) return
        node.dataset.wavoRawName = raw
        const person = visibleProfileCache.current.get(raw)
        const signature = person ? `${raw}|${person.equipped_name_style || ''}|${person.equipped_badge || ''}` : `${raw}|none`
        if (node.dataset.wavoCosmeticSignature === signature) return

        node.querySelector(':scope > .wavo-inline-badge')?.remove()
        node.classList.remove('user-label-name', 'is-gradient', 'is-animated')
        node.style.removeProperty('background-image')
        node.style.removeProperty('color')
        node.dataset.wavoCosmeticSignature = signature
        if (!person) return

        const style = byId[person.equipped_name_style]
        const badge = byId[person.equipped_badge]
        if (style?.payload?.gradient) {
          node.classList.add('user-label-name', 'is-gradient')
          if (style.payload.animated) node.classList.add('is-animated')
          node.style.backgroundImage = style.payload.gradient
        } else if (style?.payload?.color) {
          node.classList.add('user-label-name')
          node.style.color = style.payload.color
        }
        if (badge?.payload?.emoji) {
          const chip = document.createElement('span')
          chip.className = 'wavo-inline-badge'
          chip.textContent = badge.payload.emoji
          if (badge.payload.color) chip.style.color = badge.payload.color
          chip.setAttribute('aria-label', badge.name || 'Wavo badge')
          node.appendChild(chip)
        }
      })
      setTimeout(() => delete document.body.dataset.wavoCosmeticDecorating, 0)
    }

    const schedule = () => {
      clearTimeout(decorateTimer.current)
      decorateTimer.current = setTimeout(decorate, 80)
    }
    schedule()
    const observer = new MutationObserver(() => {
      if (document.body.dataset.wavoCosmeticDecorating === '1') return
      schedule()
    })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    return () => {
      disposed = true
      clearTimeout(decorateTimer.current)
      observer.disconnect()
    }
  }, [catalogue, profile?.equipped_badge, profile?.equipped_name_style])

  if (!host || !profile) return null

  const premiumThemeCount = themeItems.filter((item) => item.unlock_type === 'premium').length
  const premiumNameCount = nameItems.filter((item) => item.unlock_type === 'premium').length

  return createPortal(
    <>
      <section className="wavo-appearance-card" aria-label="Wavo appearance and Premium">
        <div className="wavo-appearance-head">
          <span className="wavo-appearance-icon"><Palette size={20} /></span>
          <div>
            <strong>Appearance</strong>
            <span>{isPremium ? 'Premium active' : 'Themes, badges and your name in Wavo'}</span>
          </div>
          {isPremium && <span className="wavo-premium-pill"><Crown size={13} /> Premium</span>}
        </div>

        {notice && <button className="wavo-appearance-notice" type="button" onClick={() => setNotice('')}>{notice}</button>}
        {stats && <div className="wavo-cosmetic-stats"><span>🔥 {stats.current_streak || 0} day streak</span><span>{stats.messages_sent || 0} sent</span></div>}

        <div className="wavo-appearance-section">
          <div className="wavo-section-title"><div><Sparkles size={15} /><strong>Theme</strong></div><span>{themeItems.length} available</span></div>
          <div className="wavo-theme-grid">
            {featuredThemes.map((item) => {
              const req = requirement(item)
              const usable = isUsable(item)
              const claimable = req?.kind === 'earned' && req.met
              return (
                <button type="button" key={item.id} className={`wavo-theme-option ${theme === item.id ? 'on' : ''} ${!usable && !claimable ? 'locked' : ''}`} onClick={() => pickTheme(item)} title={usable ? item.name : req?.detail || item.description || item.name}>
                  <span className="wavo-theme-swatch" style={swatchStyle(item)} /><span>{item.name}</span>
                  {!usable && <small>{claimable ? 'Claim' : req?.short || 'Locked'}</small>}
                </button>
              )
            })}
          </div>
          {themeItems.length > featuredThemes.length && <button className="wavo-show-all" type="button" onClick={() => setShowAllThemes(true)}>Show all {themeItems.length} themes <ChevronDown size={15} /></button>}
          {showAllThemes && <button className="wavo-show-all" type="button" onClick={() => setShowAllThemes(false)}>Show fewer themes <ChevronUp size={15} /></button>}
        </div>

        <div className="wavo-appearance-section">
          <div className="wavo-section-title"><div><Star size={15} /><strong>Your name</strong></div><span>What other people see</span></div>
          <div className="wavo-name-preview"><UserLabel user={profile} /></div>

          <span className="wavo-cos-label">Badges</span>
          <div className="wavo-cos-grid">
            {badgeItems.map((item) => {
              const req = requirement(item)
              const usable = isUsable(item)
              const claimable = req?.kind === 'earned' && req.met
              return (
                <button type="button" key={item.id} className={`wavo-cos-chip ${profile.equipped_badge === item.id ? 'on' : ''} ${!usable && !claimable ? 'locked' : ''}`} onClick={() => equip(item, 'badge')} title={usable ? item.name : req?.detail || item.description || item.name}>
                  <span style={{ color: item.payload?.color }}>{item.payload?.emoji}</span><span>{item.name}</span>
                  {!usable && <small>{claimable ? 'Claim' : req?.short || 'Locked'}</small>}
                </button>
              )
            })}
          </div>

          <span className="wavo-cos-label">Name style</span>
          <div className="wavo-cos-grid">
            {nameItems.map((item) => {
              const req = requirement(item)
              const usable = isUsable(item)
              const claimable = req?.kind === 'earned' && req.met
              return (
                <button type="button" key={item.id} className={`wavo-cos-chip ${profile.equipped_name_style === item.id ? 'on' : ''} ${!usable && !claimable ? 'locked' : ''}`} onClick={() => equip(item, 'name_style')} title={usable ? item.name : req?.detail || item.description || item.name}>
                  <span className="wavo-name-swatch" style={swatchStyle(item)} /><span>{item.name.replace(' name', '')}</span>
                  {!usable && <small>{claimable ? 'Claim' : req?.short || 'Locked'}</small>}
                </button>
              )
            })}
          </div>
        </div>

        {!isPremium && !isNativeApp && (
          <button className="wavo-premium-cta" type="button" onClick={() => setShowPremium(true)}>
            <Crown size={18} /><span><strong>Wavo Premium</strong><small>{premiumThemeCount} Premium themes · {premiumNameCount} Premium name styles</small></span><span>View</span>
          </button>
        )}
      </section>

      <Premium open={showPremium} onClose={() => setShowPremium(false)} onSubscribe={startCheckout} isPremium={isPremium} busy={checkoutBusy} error={checkoutError} />
    </>,
    host,
  )
}
