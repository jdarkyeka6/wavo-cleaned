import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Capacitor } from '@capacitor/core'
import { AppIcon } from '@capawesome/capacitor-app-icon'
import {
  BadgeCheck, Bot, Check, ChevronDown, Crown, Folder, FolderPlus, Gauge, Gem,
  Heart, Layers3, MessageSquareText, Palette, Repeat2, RotateCcw, Search, ShieldCheck,
  Sparkles, Star, WandSparkles, Zap,
} from 'lucide-react'
import { supabase } from './supabaseClient'
import {
  addMessageReaction, createChatFolder, getChatFolders, getChatPreference,
  getPremiumSettings, getSpaceStats, getStreakState, moderateContent, paidTier,
  repairStreak, saveChatPreference, savePremiumSettings, setFolderItem,
} from './premiumProData'
import {
  APPLE_PRODUCTS, isNativeIOS, loadStoreProducts, manageAppleSubscription,
  purchaseAppleTier, restoreApplePurchases, startWebCheckout,
} from './storePurchases'
import './premium-pro.css'

const PROFILE_HOST = 'data-wavo-premium-pro-host'
const INBOX_HOST = 'data-wavo-folders-host'
const CHAT_HOST = 'data-wavo-chat-power-host'
const EFFECTS = [
  ['none', 'Normal'], ['splash', '🌊 Splash'], ['confetti', '🎉 Confetti'],
  ['glow', '✨ Glow'], ['shake', '⚡ Shake'], ['heartbeat', '💗 Heartbeat'],
]
const THEMES = ['dusk', 'ocean', 'rose', 'mint', 'midnight', 'solar', 'glass']
const BUBBLES = ['classic', 'soft', 'glass', 'outline']
const BANNERS = ['ocean', 'aurora', 'ember', 'midnight', 'prism']
const FRAMES = ['none', 'wave', 'halo', 'neon', 'orbit']
const BACKGROUNDS = ['default', 'glass', 'midnight', 'sunset', 'aurora']
const ICONS = [
  ['classic', 'Classic'], ['OceanIcon', 'Ocean'], ['MidnightIcon', 'Midnight'],
  ['NeonIcon', 'Neon'], ['RoseIcon', 'Rose'],
]
const PREMIUM_REACTIONS = [['🌊', 'splash'], ['✨', 'sparkle'], ['🔥', 'flame'], ['💀', 'pop'], ['💗', 'heartbeat']]

function rank(tier) { return tier === 'pro' ? 3 : tier === 'premium' ? 2 : 1 }
function ownMessage(message, userId) { return String(message?.sender_id || message?.user_id || '') === String(userId || '') }
function priceFor(products, id, fallback) { return products.find((p) => p.identifier === id)?.priceString || fallback }

function useDomHosts() {
  const [hosts, setHosts] = useState({ profile: null, inbox: null, chat: null })
  useEffect(() => {
    const sync = () => {
      let profile = null; let inbox = null; let chat = null
      const profileScreen = document.querySelector('.profile-hero')?.closest('.screen')
      if (profileScreen) {
        profile = profileScreen.querySelector(`[${PROFILE_HOST}]`)
        if (!profile) {
          profile = document.createElement('div'); profile.setAttribute(PROFILE_HOST, ''); profile.className = 'wpp-profile-host'
          const olderPremium = profileScreen.querySelector('[data-wavo-premium-cosmetics-host]')
          if (olderPremium) profileScreen.insertBefore(profile, olderPremium)
          else profileScreen.appendChild(profile)
        }
      }
      const inboxTitle = [...document.querySelectorAll('.screen-title h1')].find((node) => node.textContent?.trim() === 'Inbox')
      const inboxScreen = inboxTitle?.closest('.screen')
      if (inboxScreen && !document.querySelector('.chat-screen')) {
        inbox = inboxScreen.querySelector(`[${INBOX_HOST}]`)
        if (!inbox) {
          inbox = document.createElement('div'); inbox.setAttribute(INBOX_HOST, ''); inbox.className = 'wpp-folders-host'
          inboxTitle.closest('.screen-title')?.after(inbox)
        }
      }
      const chatRoot = document.querySelector('.chat-screen') || document.querySelector('.space-chat-card')
      const composer = chatRoot?.querySelector('.composer')
      if (chatRoot && composer) {
        chat = chatRoot.querySelector(`[${CHAT_HOST}]`)
        if (!chat) {
          chat = document.createElement('div'); chat.setAttribute(CHAT_HOST, ''); chat.className = 'wpp-chat-host'
          composer.before(chat)
        }
      }
      setHosts((old) => old.profile === profile && old.inbox === inbox && old.chat === chat ? old : { profile, inbox, chat })
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])
  return hosts
}

async function resolveConversation(userId) {
  if (!userId) return null
  const dm = document.querySelector('.chat-screen')
  if (dm) {
    const canonical = [...dm.querySelectorAll('.chat-topbar span')]
      .map((node) => node.textContent?.trim() || '')
      .find((value) => value.startsWith('@'))
    const username = (canonical ? canonical.slice(1) : dm.querySelector('.chat-topbar strong')?.textContent?.trim()) || ''
    if (!username) return null
    const { data: friend } = await supabase.from('profiles').select('id,username').ilike('username', username).limit(1).maybeSingle()
    if (!friend?.id) return null
    return { kind: 'dm', targetId: friend.id, label: friend.username, conversationId: [userId, friend.id].sort().join('_'), root: dm }
  }
  const spaceCard = document.querySelector('.space-chat-card')
  if (spaceCard) {
    const name = document.querySelector('.space-hero h1')?.textContent?.trim()
    if (!name) return null
    const { data: group } = await supabase.from('groups').select('id,name,created_by').eq('name', name).limit(1).maybeSingle()
    if (!group?.id) return null
    return { kind: 'space', targetId: group.id, label: group.name, conversationId: group.id, creatorId: group.created_by, root: spaceCard }
  }
  return null
}

function PlanCard({ name, price, current, accent, features, onBuy, busy, button }) {
  return <article className={`wpp-plan ${accent ? 'pro' : ''} ${current ? 'current' : ''}`}>
    <div className="wpp-plan-title"><span>{accent ? <Zap size={18}/> : <Gem size={18}/>}</span><div><strong>{name}</strong><small>{price}</small></div>{current && <em>Current</em>}</div>
    <div className="wpp-feature-list">{features.map((feature) => <span key={feature}><Check size={14}/>{feature}</span>)}</div>
    {!current && <button type="button" disabled={busy} onClick={onBuy}>{busy ? 'Opening…' : button}</button>}
  </article>
}

function ProfileStudio({ userId, profile, tier, settings, setSettings, folders, setFolders, streak, setStreak, badges, products, refreshProfile }) {
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [newFolder, setNewFolder] = useState('')
  const paid = rank(tier) >= 2
  const pro = tier === 'pro'
  const native = isNativeIOS()
  const premiumProduct = products.find((item) => item.identifier === APPLE_PRODUCTS.premium)
  const proProduct = products.find((item) => item.identifier === APPLE_PRODUCTS.pro)
  const premiumPrice = premiumProduct?.priceString || (native ? 'Loading from App Store…' : 'A$4.99/month')
  const proPrice = proProduct?.priceString || (native ? 'Loading from App Store…' : 'A$14.99/month')

  async function buy(wanted) {
    setBusy(wanted); setNotice('')
    try {
      if (native && !products.find((item) => item.identifier === APPLE_PRODUCTS[wanted])) {
        throw new Error('Subscriptions are still loading from the App Store. Try again in a moment.')
      }
      if (native) await purchaseAppleTier(wanted, userId)
      else await startWebCheckout(wanted === 'pro' ? 'pro' : 'standard')
      await refreshProfile(); setNotice(`${wanted === 'pro' ? 'Wavo Pro' : 'Wavo Premium'} is active.`)
    } catch (error) { setNotice(error?.message || 'Purchase could not be completed.') }
    setBusy('')
  }

  async function restore() {
    setBusy('restore'); setNotice('')
    try { await restoreApplePurchases(); await refreshProfile(); setNotice('Apple purchases restored.') }
    catch (error) { setNotice(error?.message || 'Nothing to restore.') }
    setBusy('')
  }

  async function patch(patchValue) {
    if (!paid) return
    try { const next = await savePremiumSettings(userId, patchValue); setSettings(next); setNotice('Saved.') }
    catch (error) { setNotice(error?.message || 'Could not save that setting.') }
  }

  async function chooseIcon(value) {
    if (!paid) return
    setBusy('icon'); setNotice('')
    try {
      if (Capacitor.isNativePlatform()) {
        const { available } = await AppIcon.isAvailable()
        if (!available) throw new Error('Alternate icons are not supported on this device.')
        if (value === 'classic') await AppIcon.resetIcon()
        else await AppIcon.setIcon({ icon: value })
      }
      await patch({ app_icon: value })
    } catch (error) { setNotice(error?.message || 'Could not change the app icon.') }
    setBusy('')
  }

  async function addFolder() {
    const value = newFolder.trim(); if (!value || !paid) return
    try { const folder = await createChatFolder(userId, value, '💬'); setFolders([...(folders || []), { ...folder, items: [] }]); setNewFolder(''); setNotice('Folder created.') }
    catch (error) { setNotice(error?.message || 'Could not create that folder.') }
  }

  async function fixStreak() {
    setBusy('streak')
    try { const next = await repairStreak(); setStreak(next); setNotice('Streak repaired 🔥') }
    catch (error) { setNotice(error?.message || 'There is no recent streak available to repair.') }
    setBusy('')
  }

  function toggleBadge(id) {
    const selected = settings?.badge_showcase || []
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id].slice(-3)
    patch({ badge_showcase: next })
  }

  return <section className="wpp-hub">
    <header className="wpp-hero"><div className="wpp-gem"><Crown/></div><div><span>WAVO PAID</span><h2>{pro ? 'Wavo Pro' : paid ? 'Wavo Premium' : 'Make Wavo yours'}</h2><p>Customise everything, move faster, and unlock serious power tools.</p></div></header>
    {notice && <button className="wpp-notice" type="button" onClick={() => setNotice('')}>{notice}</button>}

    <div className="wpp-plans">
      <PlanCard name="Premium" price={premiumPrice} current={tier === 'premium'} busy={busy === 'premium'} onBuy={() => buy('premium')} button="Get Premium" features={['Profile Studio + chat themes', 'Message effects + animated reactions', 'Folders + advanced search', 'Recurring messages + streak protection', 'Wavo Labs']} />
      <PlanCard name="Pro" price={proPrice} current={pro} accent busy={busy === 'pro'} onBuy={() => buy('pro')} button={tier === 'premium' ? 'Upgrade to Pro' : 'Get Pro'} features={['Everything in Premium', 'AI chat summaries + Ask Wavo', 'Voice-note transcription', 'Space analytics + roles', 'Scheduled Space announcements']} />
    </div>

    {native && <div className="wpp-purchase-links"><button disabled={busy === 'restore'} onClick={restore}><RotateCcw size={14}/> Restore Purchases</button>{paid && <button onClick={() => manageAppleSubscription()}><Layers3 size={14}/> Manage Subscription</button>}</div>}

    {paid && <>
      <div className="wpp-section-head"><div><Palette/><strong>Profile Studio</strong></div><small>Premium</small></div>
      <div className="wpp-control-grid">
        <label>Animated banner<select value={settings?.profile_banner || 'ocean'} onChange={(e) => patch({ profile_banner: e.target.value })}>{BANNERS.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>Avatar frame<select value={settings?.avatar_frame || 'none'} onChange={(e) => patch({ avatar_frame: e.target.value })}>{FRAMES.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>Profile background<select value={settings?.profile_background || 'default'} onChange={(e) => patch({ profile_background: e.target.value })}>{BACKGROUNDS.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>Default chat theme<select value={settings?.default_chat_theme || 'dusk'} onChange={(e) => patch({ default_chat_theme: e.target.value })}>{THEMES.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>Bubble style<select value={settings?.bubble_style || 'classic'} onChange={(e) => patch({ bubble_style: e.target.value })}>{BUBBLES.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>App icon<select disabled={busy === 'icon'} value={settings?.app_icon || 'classic'} onChange={(e) => chooseIcon(e.target.value)}>{ICONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      </div>

      <div className="wpp-badges"><div><BadgeCheck size={16}/><strong>Badge showcase</strong><small>Choose up to 3</small></div><div>{badges.map((badge) => <button type="button" key={badge.id} className={(settings?.badge_showcase || []).includes(badge.id) ? 'on' : ''} onClick={() => toggleBadge(badge.id)}>{badge.payload?.emoji || '◆'} {badge.name}</button>)}</div></div>

      <div className="wpp-folders-editor"><div><FolderPlus size={16}/><strong>Chat folders</strong><small>{folders.length} folder{folders.length === 1 ? '' : 's'}</small></div><div className="wpp-folder-chips">{folders.map((folder) => <span key={folder.id}>{folder.icon} {folder.name}</span>)}</div><div className="wpp-inline-form"><input maxLength={40} value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder="New folder name"/><button onClick={addFolder} disabled={!newFolder.trim()}>Add</button></div></div>

      <div className="wpp-streak"><div><span>🔥</span><div><strong>{streak?.current_streak || 0} day streak</strong><small>{streak?.freezes || 0} freezes · {streak?.repairs || 0} repairs available</small></div></div>{(streak?.repairs || 0) > 0 && (streak?.previous_streak || 0) > 1 && <button disabled={busy === 'streak'} onClick={fixStreak}>Repair {streak.previous_streak}-day streak</button>}</div>

      <button className={`wpp-labs ${settings?.labs_enabled ? 'on' : ''}`} onClick={() => patch({ labs_enabled: !settings?.labs_enabled })}><WandSparkles/><div><strong>Wavo Labs</strong><span>Try experimental Wavo features before everyone else.</span></div><em>{settings?.labs_enabled ? 'ON' : 'OFF'}</em></button>
    </>}
  </section>
}

function InboxFolders({ folders, tier }) {
  const [active, setActive] = useState('all')
  const paid = rank(tier) >= 2
  const apply = useCallback(async (folderId) => {
    setActive(folderId)
    const rows = [...document.querySelectorAll('.friend-list .friend-button')]
    rows.forEach((row) => { row.style.display = '' })
    if (folderId === 'all') return
    if (!paid) return
    const folder = folders.find((f) => f.id === folderId)
    const ids = (folder?.items || []).filter((x) => x.kind === 'dm').map((x) => x.target_id)
    if (!ids.length) { rows.forEach((row) => { row.style.display = 'none' }); return }
    const { data } = await supabase.from('profiles').select('username').in('id', ids)
    const names = new Set((data || []).map((x) => x.username))
    rows.forEach((row) => { const username = row.querySelector('strong')?.textContent?.trim(); row.style.display = names.has(username) ? '' : 'none' })
  }, [folders, paid])
  useEffect(() => () => document.querySelectorAll('.friend-list .friend-button').forEach((row) => { row.style.display = '' }), [])
  if (!paid) return <button className="wpp-folder-upsell" type="button"><Folder size={15}/> Chat folders are included with Premium</button>
  return <div className="wpp-folder-tabs"><button className={active === 'all' ? 'on' : ''} onClick={() => apply('all')}>All</button>{folders.map((folder) => <button key={folder.id} className={active === folder.id ? 'on' : ''} onClick={() => apply(folder.id)}>{folder.icon} {folder.name}</button>)}</div>
}

function ChatPower({ userId, tier, settings, folders, setFolders }) {
  const [context, setContext] = useState(null)
  const [pref, setPref] = useState(null)
  const [effect, setEffect] = useState('none')
  const [latest, setLatest] = useState(null)
  const [reactions, setReactions] = useState([])
  const [stats, setStats] = useState(null)
  const [spaceStats, setSpaceStats] = useState(null)
  const [roleName, setRoleName] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const [announceAt, setAnnounceAt] = useState('')
  const [notice, setNotice] = useState('')
  const bypass = useRef(new WeakSet())
  const paid = rank(tier) >= 2
  const pro = tier === 'pro'

  const resolve = useCallback(async () => {
    const next = await resolveConversation(userId)
    setContext(next)
    if (!next) return
    if (paid) {
      const saved = await getChatPreference(userId, next.kind, next.targetId).catch(() => null)
      setPref(saved || { theme: settings?.default_chat_theme || 'dusk', bubble_style: settings?.bubble_style || 'classic' })
    }
  }, [userId, paid, settings?.default_chat_theme, settings?.bubble_style])

  const refreshMessages = useCallback(async () => {
    if (!context) return
    let query = context.kind === 'dm'
      ? supabase.from('messages').select('id,sender_id,receiver_id,content,type,created_at,effect').eq('chat_id', context.conversationId)
      : supabase.from('group_messages').select('id,sender_id,user_id,content,type,created_at,effect').eq('group_id', context.targetId)
    const { data } = await query.order('created_at', { ascending: true }).limit(200)
    const list = data || []
    const rows = context.kind === 'dm' ? [...document.querySelectorAll('.dm-messages .dm-row .dm-bubble')] : [...document.querySelectorAll('.space-messages .space-message')]
    const mapped = list.slice(-rows.length)
    rows.forEach((node, index) => {
      const msg = mapped[index]; if (!msg) return
      node.dataset.wavoMessageId = msg.id
      if (msg.effect) node.dataset.wavoEffect = msg.effect; else delete node.dataset.wavoEffect
    })
    const incoming = [...list].reverse().find((m) => !ownMessage(m, userId)) || list.at(-1) || null
    setLatest(incoming)
    if (incoming?.id) {
      const { data: r } = await supabase.from('message_reactions').select('emoji,effect,user_id').eq('message_kind', context.kind).eq('message_id', incoming.id)
      setReactions(r || [])
    } else setReactions([])
    if (paid && context.kind === 'dm' && list.length) setStats({ count: list.length, first: list[0].created_at })
    if (pro && context.kind === 'space') getSpaceStats(context.targetId).then(setSpaceStats).catch(() => setSpaceStats(null))
  }, [context, userId, paid, pro])

  useEffect(() => {
    resolve(); const timer = setInterval(resolve, 1200); return () => clearInterval(timer)
  }, [resolve])
  useEffect(() => { if (context) refreshMessages() }, [context?.targetId, refreshMessages])

  useEffect(() => {
    const root = context?.root
    if (!root) return
    root.dataset.wavoChatTheme = pref?.theme || settings?.default_chat_theme || 'dusk'
    root.dataset.wavoBubbleStyle = pref?.bubble_style || settings?.bubble_style || 'classic'
  }, [context, pref, settings?.default_chat_theme, settings?.bubble_style])

  useEffect(() => {
    async function intercept(event) {
      const form = event.target
      if (!(form instanceof HTMLFormElement)) return
      if (!form.matches('.composer, .create-form')) return
      if (bypass.current.has(form)) { bypass.current.delete(form); return }
      const text = [...form.querySelectorAll('textarea,input:not([type]),input[type="text"]')].map((x) => x.value).filter(Boolean).join('\n').trim()
      if (!text) return
      event.preventDefault(); event.stopPropagation()
      try {
        const check = await moderateContent(text)
        if (!check?.allowed) { window.alert('Wavo blocked this because it may contain seriously unsafe content.'); return }
        bypass.current.add(form); form.requestSubmit()
        if (paid && effect !== 'none' && form.classList.contains('composer')) {
          setTimeout(async () => {
            const nowContext = await resolveConversation(userId)
            if (!nowContext) return
            const table = nowContext.kind === 'dm' ? 'messages' : 'group_messages'
            let q = supabase.from(table).select('id,created_at')
            q = nowContext.kind === 'dm' ? q.eq('chat_id', nowContext.conversationId).eq('sender_id', userId) : q.eq('group_id', nowContext.targetId).or(`sender_id.eq.${userId},user_id.eq.${userId}`)
            const { data } = await q.order('created_at', { ascending: false }).limit(1).maybeSingle()
            if (data?.id && Date.now() - new Date(data.created_at).getTime() < 15000) await supabase.from(table).update({ effect }).eq('id', data.id)
            refreshMessages()
          }, 550)
        }
      } catch { window.alert('Wavo could not run its safety check. Try sending again in a moment.') }
    }
    document.addEventListener('submit', intercept, true)
    return () => document.removeEventListener('submit', intercept, true)
  }, [userId, paid, effect, refreshMessages])

  if (!context) return null

  async function savePref(patch) {
    if (!paid) return
    try { const next = await saveChatPreference(userId, context.kind, context.targetId, { ...(pref || {}), ...patch }); setPref(next); setNotice('Saved for this chat.') }
    catch (error) { setNotice(error?.message || 'Could not save chat style.') }
  }

  async function react(emoji, reactionEffect) {
    if (!latest?.id || !paid) return
    try { await addMessageReaction({ messageKind: context.kind, messageId: latest.id, userId, emoji, effect: reactionEffect }); await refreshMessages() }
    catch (error) { setNotice(error?.message || 'Could not react.') }
  }

  async function toggleFolder(folder) {
    const enabled = !(folder.items || []).some((item) => item.kind === context.kind && String(item.target_id) === String(context.targetId))
    try {
      await setFolderItem(userId, folder.id, context.kind, context.targetId, enabled)
      const next = await getChatFolders(userId); setFolders(next)
    } catch (error) { setNotice(error?.message || 'Could not update folder.') }
  }

  async function createRole() {
    if (!pro || context.kind !== 'space' || !roleName.trim()) return
    const { error } = await supabase.from('space_roles').insert({ group_id: context.targetId, name: roleName.trim(), created_by: userId, permissions: { moderate: true } })
    setNotice(error ? error.message : 'Space role created.'); if (!error) setRoleName('')
  }

  async function scheduleAnnouncement() {
    if (!pro || context.kind !== 'space' || !announcement.trim() || !announceAt) return
    const { error } = await supabase.from('space_scheduled_announcements').insert({ group_id: context.targetId, created_by: userId, content: announcement.trim(), send_at: new Date(announceAt).toISOString() })
    setNotice(error ? error.message : 'Announcement scheduled.'); if (!error) { setAnnouncement(''); setAnnounceAt('') }
  }

  return <section className="wpp-chat-power">
    <div className="wpp-chat-title"><Sparkles size={15}/><strong>{paid ? 'Premium tools' : 'Make this chat yours'}</strong><span>{pro ? 'PRO' : paid ? 'PREMIUM' : 'FREE'}</span></div>
    {notice && <button className="wpp-mini-notice" onClick={() => setNotice('')}>{notice}</button>}
    {paid ? <>
      <div className="wpp-chat-controls"><label>Theme<select value={pref?.theme || settings?.default_chat_theme || 'dusk'} onChange={(e) => savePref({ theme: e.target.value })}>{THEMES.map((x) => <option key={x}>{x}</option>)}</select></label><label>Bubbles<select value={pref?.bubble_style || settings?.bubble_style || 'classic'} onChange={(e) => savePref({ bubble_style: e.target.value })}>{BUBBLES.map((x) => <option key={x}>{x}</option>)}</select></label></div>
      <div className="wpp-effects"><small>Next message effect</small><div>{EFFECTS.map(([id, label]) => <button key={id} className={effect === id ? 'on' : ''} onClick={() => setEffect(id)}>{label}</button>)}</div></div>
      {latest && <div className="wpp-react"><small>React to latest message</small><div>{PREMIUM_REACTIONS.map(([emoji, fx]) => <button key={emoji} onClick={() => react(emoji, fx)}>{emoji}</button>)}</div>{reactions.length > 0 && <span>{reactions.map((r) => r.emoji).join(' ')}</span>}</div>}
      <div className="wpp-folder-assign"><small>Folders</small><div>{folders.map((folder) => { const on = (folder.items || []).some((item) => item.kind === context.kind && String(item.target_id) === String(context.targetId)); return <button key={folder.id} className={on ? 'on' : ''} onClick={() => toggleFolder(folder)}>{folder.icon} {folder.name}</button> })}</div></div>
      {stats && <div className="wpp-friend-stats"><Star size={14}/><span><strong>{stats.count}</strong> messages · talking since {new Date(stats.first).toLocaleDateString()}</span></div>}
    </> : <div className="wpp-chat-upsell"><Gem size={17}/><span>Premium adds themes, animated effects, reactions, folders and chat stats.</span></div>}

    {context.kind === 'space' && pro && <details className="wpp-space-pro"><summary><Gauge size={15}/> Pro Space controls <ChevronDown size={14}/></summary>
      {spaceStats && <div className="wpp-stat-grid"><span><strong>{spaceStats.members}</strong> members</span><span><strong>{spaceStats.messages_7d}</strong> messages / 7d</span><span><strong>{spaceStats.messages_30d}</strong> messages / 30d</span><span><strong>{spaceStats.active_senders_7d}</strong> active / 7d</span></div>}
      <div className="wpp-inline-form"><input value={roleName} onChange={(e) => setRoleName(e.target.value)} placeholder="New role name"/><button onClick={createRole}>Create role</button></div>
      <div className="wpp-announcement"><textarea value={announcement} onChange={(e) => setAnnouncement(e.target.value)} placeholder="Scheduled Space announcement"/><input type="datetime-local" value={announceAt} onChange={(e) => setAnnounceAt(e.target.value)}/><button disabled={!announcement.trim() || !announceAt} onClick={scheduleAnnouncement}><Repeat2 size={14}/> Schedule announcement</button></div>
    </details>}
  </section>
}

export default function PremiumProEnhancement() {
  const hosts = useDomHosts()
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [settings, setSettings] = useState(null)
  const [folders, setFolders] = useState([])
  const [streak, setStreak] = useState(null)
  const [badges, setBadges] = useState([])
  const [products, setProducts] = useState([])
  const userId = session?.user?.id || null
  const tier = paidTier(profile)

  const refreshProfile = useCallback(async () => {
    if (!userId) return null
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
    setProfile(data || null); return data
  }, [userId])

  const refreshPaidData = useCallback(async () => {
    if (!userId) return
    const [s, f, st, badgeRows] = await Promise.all([
      getPremiumSettings().catch(() => null),
      getChatFolders(userId).catch(() => []),
      getStreakState().catch(() => null),
      supabase.from('cosmetics').select('id,name,payload,min_tier,unlock_type').eq('kind', 'badge').order('sort_order').then(({ data }) => data || []),
    ])
    setSettings(s); setFolders(f); setStreak(st); setBadges(badgeRows)
  }, [userId])

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(({ data }) => { if (alive) setSession(data.session || null) })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => { if (alive) setSession(next || null) })
    return () => { alive = false; listener.subscription.unsubscribe() }
  }, [])
  useEffect(() => { if (userId) { refreshProfile(); refreshPaidData(); if (isNativeIOS()) loadStoreProducts().then(setProducts).catch(() => setProducts([])) } }, [userId, refreshProfile, refreshPaidData])

  useEffect(() => {
    const root = document.documentElement
    root.dataset.wavoProfileBanner = settings?.profile_banner || 'ocean'
    root.dataset.wavoAvatarFrame = settings?.avatar_frame || 'none'
    root.dataset.wavoProfileBackground = settings?.profile_background || 'default'
  }, [settings])

  useEffect(() => {
    if (!userId) return
    const channel = supabase.channel(`wpp-profile-${userId}`).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` }, () => refreshProfile()).subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userId, refreshProfile])

  const eligibleBadges = useMemo(() => badges.filter((badge) => {
    const need = String(badge.min_tier || (badge.unlock_type === 'premium' ? 'premium' : 'free')).toLowerCase()
    return rank(tier) >= rank(need === 'vip' ? 'pro' : need)
  }), [badges, tier])

  if (!userId || !profile) return null
  return <>
    {hosts.profile && createPortal(<ProfileStudio userId={userId} profile={profile} tier={tier} settings={settings} setSettings={setSettings} folders={folders} setFolders={setFolders} streak={streak} setStreak={setStreak} badges={eligibleBadges} products={products} refreshProfile={refreshProfile}/>, hosts.profile)}
    {hosts.inbox && createPortal(<InboxFolders folders={folders} tier={tier}/>, hosts.inbox)}
    {hosts.chat && createPortal(<ChatPower userId={userId} tier={tier} settings={settings} folders={folders} setFolders={setFolders}/>, hosts.chat)}
  </>
}
