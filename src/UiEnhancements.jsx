import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { BellOff, Check, Plus, Trash2, Users } from 'lucide-react'
import { supabase } from './supabaseClient'
import { ensureNotificationPermission, registerForPush } from './push'
import { isNativeApp, isIOS } from './lib/platform'

const PUSH_DISABLED_KEY = 'wavo_push_disabled'
const PUSH_TOKEN_KEY = 'wavo_push_device_token'

async function getCurrentWebSubscription() {
  if (isNativeApp || !('serviceWorker' in navigator)) return null
  const reg = await navigator.serviceWorker.ready
  return reg.pushManager?.getSubscription?.() || null
}

function AudiencePresets({ host, userId }) {
  const [presets, setPresets] = useState([])
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    if (!userId) return
    const { data, error } = await supabase
      .from('audience_presets')
      .select('id,name,member_usernames,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
    if (!error) setPresets(data || [])
  }

  useEffect(() => { load() }, [userId])

  const peopleButtons = () => [...host.closest('.post-audience-picker').querySelectorAll('.audience-person')]
  const selectedNames = () => peopleButtons()
    .filter((button) => button.classList.contains('selected'))
    .map((button) => button.querySelector(':scope > span')?.textContent?.trim())
    .filter(Boolean)

  function applyPreset(preset) {
    const wanted = new Set((preset.member_usernames || []).map((value) => value.toLowerCase()))
    for (const button of peopleButtons()) {
      const username = button.querySelector(':scope > span')?.textContent?.trim()?.toLowerCase()
      const selected = button.classList.contains('selected')
      const shouldSelect = wanted.has(username)
      if (selected !== shouldSelect) button.click()
    }
  }

  async function savePreset(e) {
    e.preventDefault()
    const members = selectedNames()
    const cleanName = name.trim()
    if (!cleanName || !members.length || busy) return
    setBusy(true)
    const { error } = await supabase.from('audience_presets').insert({
      user_id: userId,
      name: cleanName,
      member_usernames: members,
    })
    setBusy(false)
    if (!error) {
      setName('')
      setCreating(false)
      load()
    }
  }

  async function removePreset(id) {
    await supabase.from('audience_presets').delete().eq('id', id).eq('user_id', userId)
    load()
  }

  return createPortal(
    <div className="wavo-audience-presets">
      <div className="wavo-preset-title">
        <span><Users size={14} /> Presets</span>
        <button type="button" onClick={() => setCreating((value) => !value)}><Plus size={14} /> Add preset</button>
      </div>
      {presets.length > 0 && (
        <div className="wavo-preset-chips">
          {presets.map((preset) => (
            <span className="wavo-preset-chip" key={preset.id}>
              <button type="button" onClick={() => applyPreset(preset)}>{preset.name}</button>
              <button type="button" className="wavo-preset-delete" aria-label={`Delete ${preset.name} preset`} onClick={() => removePreset(preset.id)}>
                <Trash2 size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      {!presets.length && !creating && <span className="wavo-preset-empty">Save groups like Family, Close Friends or School once, then reuse them.</span>}
      {creating && (
        <form className="wavo-preset-form" onSubmit={savePreset}>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} placeholder="Family" autoFocus />
          <button type="submit" disabled={busy || !name.trim()}><Check size={14} /> {busy ? 'Saving…' : 'Save current selection'}</button>
        </form>
      )}
    </div>,
    host,
  )
}

function NotificationToggle({ host, userId }) {
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    async function check() {
      if (!userId || localStorage.getItem(PUSH_DISABLED_KEY) === '1') {
        if (live) setEnabled(false)
        return
      }

      if (isNativeApp && isIOS()) {
        try {
          const { PushNotifications } = await import('@capacitor/push-notifications')
          const permission = await PushNotifications.checkPermissions()
          if (permission.receive === 'granted') {
            const token = await registerForPush(userId)
            if (token) localStorage.setItem(PUSH_TOKEN_KEY, token)
            if (live) setEnabled(Boolean(token))
          }
        } catch {
          if (live) setEnabled(false)
        }
        return
      }

      try {
        const sub = await getCurrentWebSubscription()
        if (live) setEnabled(Boolean(sub))
      } catch {
        if (live) setEnabled(false)
      }
    }
    check()
    return () => { live = false }
  }, [userId])

  async function enable() {
    if (!userId || busy) return
    setBusy(true)
    try {
      const allowed = await ensureNotificationPermission()
      if (!allowed) return
      const tokenOrSub = await registerForPush(userId)
      if (typeof tokenOrSub === 'string') localStorage.setItem(PUSH_TOKEN_KEY, tokenOrSub)
      localStorage.removeItem(PUSH_DISABLED_KEY)
      setEnabled(Boolean(tokenOrSub))
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    if (!userId || busy) return
    setBusy(true)
    try {
      localStorage.setItem(PUSH_DISABLED_KEY, '1')
      if (isNativeApp && isIOS()) {
        const { PushNotifications } = await import('@capacitor/push-notifications')
        const token = localStorage.getItem(PUSH_TOKEN_KEY)
        await PushNotifications.unregister()
        if (token) {
          await supabase.from('push_subscriptions').delete().eq('user_id', userId).eq('device_token', token)
        }
        localStorage.removeItem(PUSH_TOKEN_KEY)
      } else {
        const sub = await getCurrentWebSubscription()
        if (sub) {
          const endpoint = sub.endpoint
          await sub.unsubscribe()
          await supabase.from('push_subscriptions').delete().eq('user_id', userId).eq('endpoint', endpoint)
        }
      }
      setEnabled(false)
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <button className={enabled ? 'secondary-btn wavo-notification-toggle enabled' : 'secondary-btn wavo-notification-toggle'} type="button" disabled={busy} onClick={enabled ? disable : enable}>
      {enabled ? <BellOff size={16} /> : null}
      {busy ? (enabled ? 'Disabling…' : 'Enabling…') : enabled ? 'Disable notifications' : 'Enable notifications'}
    </button>,
    host,
  )
}

function applyWavesProductLabels() {
  const createButtons = [...document.querySelectorAll('.create-grid > button')]
  for (const button of createButtons) {
    const title = button.querySelector('strong')
    const hint = button.querySelector('span')
    if (title?.textContent?.trim() === 'Post') {
      title.textContent = 'Wave'
      if (hint) hint.textContent = 'Share with friends or chosen people'
    } else if (title?.textContent?.trim() === 'Wave') {
      button.style.display = 'none'
      button.dataset.oldWaveHidden = '1'
    }
  }

  const sections = [...document.querySelectorAll('.screen section')]
  const oldWaveSection = sections.find((section) =>
    section.querySelector('.eyebrow')?.textContent?.trim() === 'WAVES' &&
    section.querySelector('h2')?.textContent?.trim() === 'From your people'
  )
  if (oldWaveSection) oldWaveSection.style.display = 'none'

  const postsSection = sections.find((section) => section.querySelector('.eyebrow')?.textContent?.trim() === 'POSTS')
  if (postsSection) {
    const eyebrow = postsSection.querySelector('.eyebrow')
    const heading = postsSection.querySelector('h2')
    const action = postsSection.querySelector('.section-heading > button')
    if (eyebrow) eyebrow.textContent = 'WAVES'
    if (heading) heading.textContent = 'From your friends'
    if (action) action.textContent = 'New Wave'

    const headingRow = postsSection.querySelector('.section-heading')
    if (headingRow && !headingRow.querySelector('.wavo-open-waves')) {
      const link = document.createElement('a')
      link.className = 'wavo-open-waves'
      link.href = '/waves'
      link.textContent = 'Open Waves'
      headingRow.insertBefore(link, action || null)
    }
  }

  const profileEyebrow = [...document.querySelectorAll('.eyebrow')].find((node) => node.textContent?.trim() === 'YOUR POSTS')
  if (profileEyebrow) {
    profileEyebrow.textContent = 'YOUR WAVES'
    const section = profileEyebrow.closest('section')
    const action = section?.querySelector('.section-heading > button')
    if (action) action.textContent = 'New Wave'
  }

  const spaceQuickActions = [...document.querySelectorAll('.quick-actions > button')]
  for (const button of spaceQuickActions) {
    if (button.textContent?.trim() === 'Wave') button.style.display = 'none'
  }
}

export default function UiEnhancements() {
  const [userId, setUserId] = useState(null)
  const [presetHost, setPresetHost] = useState(null)
  const [notificationHost, setNotificationHost] = useState(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id || null))
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setUserId(session?.user?.id || null))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    let raf = 0
    function scan() {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        applyWavesProductLabels()

        const picker = document.querySelector('.post-audience-picker')
        if (picker) {
          let host = picker.querySelector('[data-wavo-preset-host]')
          if (!host) {
            host = document.createElement('div')
            host.dataset.wavoPresetHost = '1'
            const list = picker.querySelector('.audience-list')
            picker.insertBefore(host, list || null)
          }
          setPresetHost(host)
        } else {
          setPresetHost(null)
        }

        const cards = [...document.querySelectorAll('.settings-card')]
        const notificationCard = cards.find((card) => card.querySelector('.settings-head strong')?.textContent?.trim() === 'Notifications')
        if (notificationCard) {
          const oldButton = notificationCard.querySelector(':scope > .secondary-btn:not(.wavo-notification-toggle)')
          if (oldButton) oldButton.style.display = 'none'
          let host = notificationCard.querySelector('[data-wavo-notification-host]')
          if (!host) {
            host = document.createElement('div')
            host.dataset.wavoNotificationHost = '1'
            notificationCard.appendChild(host)
          }
          setNotificationHost(host)
        } else {
          setNotificationHost(null)
        }
      })
    }

    scan()
    const observer = new MutationObserver(scan)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [])

  return <>
    {presetHost && userId && <AudiencePresets host={presetHost} userId={userId} />}
    {notificationHost && userId && <NotificationToggle host={notificationHost} userId={userId} />}
  </>
}
