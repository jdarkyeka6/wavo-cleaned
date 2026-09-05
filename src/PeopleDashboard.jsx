import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Activity,
  ChevronRight,
  Clock3,
  Gamepad2,
  Headphones,
  MessageCircle,
  Music2,
  Radio,
  Settings2,
  Sparkles,
  Users,
  X,
} from 'lucide-react'
import { supabase } from './supabaseClient'
import { getFriends, getProfile } from './wavoData'
import { getTogetherSnapshot } from './togetherData'
import {
  getOwnPresence,
  getVisiblePresence,
  heartbeatPresence,
  presenceLabel,
  presenceRank,
  savePresence,
  setPresenceActivity,
} from './presenceData'
import './people-dashboard.css'

function initial(name) {
  return String(name || 'W').trim().slice(0, 1).toUpperCase()
}

function Avatar({ person }) {
  return (
    <span className="pd-avatar">
      {person?.avatar_url ? <img src={person.avatar_url} alt="" /> : initial(person?.username)}
    </span>
  )
}

function timeLeft(ts) {
  const mins = Math.max(0, Math.ceil((new Date(ts).getTime() - Date.now()) / 60000))
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  return `${hours}h ${mins % 60}m`
}

function activityIcon(kind) {
  if (kind === 'music') return Music2
  if (kind === 'gaming') return Gamepad2
  return Activity
}

function openChat(username) {
  const inbox = [...document.querySelectorAll('.bottom-nav button')].find((button) => button.textContent?.trim().includes('Inbox'))
  inbox?.click()
  window.setTimeout(() => {
    const row = [...document.querySelectorAll('.friend-button')].find((button) => {
      const name = button.querySelector('strong')?.textContent?.trim()
      return name === username
    })
    row?.click()
  }, 80)
}

function PresenceEditor({ own, friends, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    availability: own?.availability || 'active',
    activity_kind: own?.activity_kind || 'status',
    activity_text: own?.activity_text || '',
    activity_emoji: own?.activity_emoji || '',
    share_presence: !!own?.share_presence,
    share_activity: !!own?.share_activity,
    share_music: !!own?.share_music,
    share_gaming: !!own?.share_gaming,
    audience_mode: own?.audience_mode || 'nobody',
    audience: own?.audience || [],
    hours: 2,
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function toggleAudience(id) {
    setForm((current) => ({
      ...current,
      audience: current.audience.includes(id)
        ? current.audience.filter((value) => value !== id)
        : [...current.audience, id],
    }))
  }

  async function save() {
    setBusy(true)
    setError('')
    try {
      const { hours, ...settings } = form
      await savePresence(own.user_id, settings)
      await setPresenceActivity(own.user_id, {
        kind: form.activity_kind,
        text: form.activity_text,
        emoji: form.activity_emoji,
        hours,
      })
      await onSaved()
      onClose()
    } catch (err) {
      console.error('[wavo presence] save', err)
      setError(err?.message || 'Could not save presence.')
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="pd-modal-layer" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="pd-modal" role="dialog" aria-modal="true" aria-label="Presence settings">
        <header>
          <div><span>Presence 2.0</span><h2>What should your people see?</h2></div>
          <button onClick={onClose} aria-label="Close"><X size={20} /></button>
        </header>

        <div className="pd-field">
          <strong>Availability</strong>
          <div className="pd-segments">
            {[
              ['active', 'Active'],
              ['free', 'Free to talk'],
              ['busy', 'Busy'],
              ['away', 'Away'],
            ].map(([value, label]) => (
              <button key={value} className={form.availability === value ? 'active' : ''} onClick={() => setForm({ ...form, availability: value })}>{label}</button>
            ))}
          </div>
        </div>

        <div className="pd-field">
          <strong>What are you doing?</strong>
          <div className="pd-activity-row">
            <select value={form.activity_kind} onChange={(e) => setForm({ ...form, activity_kind: e.target.value })}>
              <option value="status">Status</option>
              <option value="gaming">Gaming</option>
              <option value="music">Music</option>
              <option value="school">School</option>
              <option value="sport">Sport</option>
              <option value="other">Other</option>
            </select>
            <input className="pd-emoji-input" value={form.activity_emoji} maxLength={4} placeholder="⚡" onChange={(e) => setForm({ ...form, activity_emoji: e.target.value })} />
          </div>
          <input value={form.activity_text} maxLength={120} placeholder="Gaming with Hudson, at tennis, listening to…" onChange={(e) => setForm({ ...form, activity_text: e.target.value })} />
          <select value={form.hours} onChange={(e) => setForm({ ...form, hours: Number(e.target.value) })}>
            <option value={1}>Expire in 1 hour</option>
            <option value={2}>Expire in 2 hours</option>
            <option value={4}>Expire in 4 hours</option>
            <option value={8}>Expire in 8 hours</option>
          </select>
        </div>

        <div className="pd-field">
          <strong>Sharing</strong>
          <button className="pd-toggle-row" onClick={() => setForm({ ...form, share_presence: !form.share_presence })}><span>Share presence</span><i className={form.share_presence ? 'on' : ''}><b /></i></button>
          <button className="pd-toggle-row" onClick={() => setForm({ ...form, share_activity: !form.share_activity })}><span>Share what I’m doing</span><i className={form.share_activity ? 'on' : ''}><b /></i></button>
          <button className="pd-toggle-row" onClick={() => setForm({ ...form, share_music: !form.share_music })}><span>Allow music activity</span><i className={form.share_music ? 'on' : ''}><b /></i></button>
          <button className="pd-toggle-row" onClick={() => setForm({ ...form, share_gaming: !form.share_gaming })}><span>Allow gaming activity</span><i className={form.share_gaming ? 'on' : ''}><b /></i></button>
        </div>

        <div className="pd-field">
          <strong>Who can see it?</strong>
          <div className="pd-segments">
            {[
              ['friends', 'All friends'],
              ['selected', 'Selected'],
              ['nobody', 'Nobody'],
            ].map(([value, label]) => <button key={value} className={form.audience_mode === value ? 'active' : ''} onClick={() => setForm({ ...form, audience_mode: value })}>{label}</button>)}
          </div>
          {form.audience_mode === 'selected' && (
            <div className="pd-audience">
              {friends.map((friend) => (
                <button key={friend.id} className={form.audience.includes(friend.id) ? 'selected' : ''} onClick={() => toggleAudience(friend.id)}>
                  <Avatar person={friend} /><span>{friend.username}</span><b>{form.audience.includes(friend.id) ? '✓' : '+'}</b>
                </button>
              ))}
            </div>
          )}
        </div>

        {error && <p className="pd-error">{error}</p>}
        <button className="pd-save" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save presence'}</button>
      </section>
    </div>,
    document.body,
  )
}

export default function PeopleDashboard() {
  const [mount, setMount] = useState(null)
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [friends, setFriends] = useState([])
  const [presence, setPresence] = useState([])
  const [own, setOwn] = useState(null)
  const [together, setTogether] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const userId = session?.user?.id

  useEffect(() => {
    let disposed = false
    function syncMount() {
      const screen = document.querySelector('.home-screen')
      if (!screen) {
        setMount(null)
        return
      }
      let target = screen.querySelector(':scope > .people-dashboard-mount')
      if (!target) {
        target = document.createElement('div')
        target.className = 'people-dashboard-mount'
        const hero = screen.querySelector(':scope > .hero-card')
        if (hero?.nextSibling) screen.insertBefore(target, hero.nextSibling)
        else screen.appendChild(target)
      }
      if (!disposed) setMount(target)
    }
    const observer = new MutationObserver(syncMount)
    observer.observe(document.body, { childList: true, subtree: true })
    syncMount()
    return () => {
      disposed = true
      observer.disconnect()
      document.querySelector('.people-dashboard-mount')?.remove()
    }
  }, [])

  async function load(id = userId) {
    if (!id) return
    try {
      const [nextProfile, nextFriends, visible, ownRow, snapshot] = await Promise.all([
        getProfile(id),
        getFriends(id),
        getVisiblePresence(),
        getOwnPresence(id),
        getTogetherSnapshot(id),
      ])
      setProfile(nextProfile)
      setFriends(nextFriends)
      setPresence(visible)
      setOwn(ownRow)
      setTogether(snapshot)
    } catch (err) {
      console.warn('[wavo dashboard] refresh failed', err)
    }
  }

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return
      const next = data?.session || null
      setSession(next)
      if (next?.user?.id) {
        try { await heartbeatPresence(next.user.id) } catch {}
        await load(next.user.id)
      }
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!alive) return
      setSession(next)
      if (next?.user?.id) load(next.user.id)
    })
    return () => {
      alive = false
      listener?.subscription?.unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    if (!userId) return undefined
    const beat = window.setInterval(() => heartbeatPresence(userId).catch(() => {}), 60000)
    const refresh = window.setInterval(() => load(userId), 20000)
    return () => {
      window.clearInterval(beat)
      window.clearInterval(refresh)
    }
  }, [userId])

  const people = useMemo(() => {
    const profileById = new Map(friends.map((friend) => [friend.id, friend]))
    return presence
      .filter((row) => row.user_id !== userId && profileById.has(row.user_id))
      .map((row) => ({ ...row, person: profileById.get(row.user_id) }))
      .sort((a, b) => presenceRank(a) - presenceRank(b))
  }, [friends, presence, userId])

  if (!mount || !session) return settingsOpen && own ? <PresenceEditor own={own} friends={friends} onClose={() => setSettingsOpen(false)} onSaved={() => load()} /> : null

  const activeInvites = (together?.invites || []).filter((invite) => new Date(invite.ends_at) > new Date())
  const liveRooms = together?.rooms || []
  const freeCount = people.filter((row) => presenceLabel(row) === 'Free to talk').length
  const activeCount = people.filter((row) => ['Free to talk', 'Active now'].includes(presenceLabel(row))).length

  const dashboard = (
    <section className="people-dashboard">
      <div className="pd-heading">
        <div><span className="pd-kicker">WHAT’S HAPPENING?</span><h2>Your people, right now.</h2></div>
        <button className="pd-settings" onClick={() => setSettingsOpen(true)}><Settings2 size={17} /><span>Presence</span></button>
      </div>

      <div className="pd-summary">
        <span><Radio size={14} /> {activeCount} active</span>
        <span><MessageCircle size={14} /> {freeCount} free</span>
        <span><Users size={14} /> {liveRooms.length} live room{liveRooms.length === 1 ? '' : 's'}</span>
      </div>

      {people.length > 0 ? (
        <div className="pd-people-strip">
          {people.slice(0, 6).map((row) => {
            const Icon = activityIcon(row.activity_kind)
            return (
              <button key={row.user_id} className="pd-person-card" onClick={() => openChat(row.person.username)}>
                <div className="pd-avatar-wrap"><Avatar person={row.person} /><i className={presenceLabel(row) === 'Free to talk' ? 'free' : presenceLabel(row) === 'Active now' ? 'active' : ''} /></div>
                <div className="pd-person-copy">
                  <strong>{row.person.username}</strong>
                  <span>{presenceLabel(row)}</span>
                  {row.activity_text && <small><Icon size={12} /> {row.activity_emoji || ''} {row.activity_text}</small>}
                </div>
                <ChevronRight size={16} />
              </button>
            )
          })}
        </div>
      ) : (
        <div className="pd-empty"><Sparkles size={16} /><span>When friends share Presence, they’ll appear here.</span></div>
      )}

      {(activeInvites.length > 0 || liveRooms.length > 0) && (
        <div className="pd-live-grid">
          {activeInvites.slice(0, 2).map((invite) => {
            const owner = invite.owner_id === userId ? profile : friends.find((friend) => friend.id === invite.owner_id)
            const going = (invite.responses || []).filter((response) => response.response === 'yep').length
            return (
              <button key={invite.id} className="pd-live-card" onClick={() => document.querySelector('.wt-launcher')?.click()}>
                <span className="pd-live-icon">⚡</span>
                <div><small>COME? · {timeLeft(invite.ends_at)} LEFT</small><strong>{invite.title}</strong><span>{owner?.username || 'Friend'} · {going} going{invite.location ? ` · ${invite.location}` : ''}</span></div>
              </button>
            )
          })}
          {liveRooms.slice(0, 2).map((room) => {
            const owner = room.owner_id === userId ? profile : friends.find((friend) => friend.id === room.owner_id)
            return (
              <button key={room.id} className="pd-live-card" onClick={() => document.querySelector('.wt-launcher')?.click()}>
                <span className="pd-live-icon"><Headphones size={19} /></span>
                <div><small>LIVE HANGOUT</small><strong>{room.title}</strong><span>{owner?.username || 'Friend'} · {room.members?.length || 0} in room</span></div>
              </button>
            )
          })}
        </div>
      )}

      {own && !own.share_presence && (
        <button className="pd-optin" onClick={() => setSettingsOpen(true)}><Clock3 size={16} /><span><strong>Your Presence is private.</strong> Tap to choose who can see you.</span><ChevronRight size={16} /></button>
      )}
    </section>
  )

  return (
    <>
      {createPortal(dashboard, mount)}
      {settingsOpen && own && <PresenceEditor own={own} friends={friends} onClose={() => setSettingsOpen(false)} onSaved={() => load()} />}
    </>
  )
}
