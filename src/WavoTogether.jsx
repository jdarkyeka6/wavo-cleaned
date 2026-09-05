import { useEffect, useMemo, useState } from 'react'
import {
  CalendarDays,
  Check,
  Clock3,
  Gamepad2,
  Hand,
  Headphones,
  MapPin,
  Music2,
  Phone,
  Plus,
  Radio,
  RefreshCw,
  Sparkles,
  Trophy,
  Users,
  X,
} from 'lucide-react'
import { supabase } from './supabaseClient'
import { getFriends, getProfile } from './wavoData'
import {
  addSharedQueueItem,
  clearExpiringStatus,
  closeDropinRoom,
  closeSharedQueue,
  createComeInvite,
  createDropinRoom,
  createFriendCircle,
  createSharedQueue,
  deleteFriendCircle,
  getTogetherSnapshot,
  playRps,
  respondKnock,
  rpsResult,
  sendKnock,
  setComeResponse,
  setDropinMembership,
  setExpiringStatus,
  startChatGame,
} from './togetherData'
import './wavo-together.css'

const TABS = [
  ['now', 'Now', Radio],
  ['come', 'Come?', CalendarDays],
  ['hangout', 'Hangout', Headphones],
  ['play', 'Play', Gamepad2],
  ['recap', 'Recap', Trophy],
]

function initials(name) {
  return String(name || 'W').trim().slice(0, 1).toUpperCase()
}

function Person({ person, small = false }) {
  return (
    <span className={small ? 'wt-person wt-person-small' : 'wt-person'}>
      <span className="wt-avatar">{person?.avatar_url ? <img src={person.avatar_url} alt="" /> : initials(person?.username)}</span>
      <span>{person?.username || 'Wavo user'}</span>
    </span>
  )
}

function timeLeft(ts) {
  if (!ts) return ''
  const mins = Math.max(0, Math.round((new Date(ts).getTime() - Date.now()) / 60000))
  if (mins < 60) return `${mins}m left`
  const hours = Math.floor(mins / 60)
  return `${hours}h ${mins % 60}m left`
}

function relative(ts) {
  if (!ts) return ''
  const mins = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 60000))
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  if (mins < 1440) return `${Math.floor(mins / 60)}h`
  return `${Math.floor(mins / 1440)}d`
}

function AudiencePicker({ friends, selected, setSelected }) {
  return (
    <div className="wt-audience">
      {friends.map((friend) => {
        const on = selected.includes(friend.id)
        return (
          <button type="button" key={friend.id} className={on ? 'selected' : ''} onClick={() => setSelected(on ? selected.filter((id) => id !== friend.id) : [...selected, friend.id])}>
            <Person person={friend} small />
            <i>{on ? '✓' : '+'}</i>
          </button>
        )
      })}
    </div>
  )
}

function Empty({ children }) {
  return <div className="wt-empty"><Sparkles size={17} />{children}</div>
}

export default function WavoTogether() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [friends, setFriends] = useState([])
  const [snapshot, setSnapshot] = useState(null)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('now')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [statusText, setStatusText] = useState('')
  const [statusHours, setStatusHours] = useState(2)
  const [come, setCome] = useState({ title: '', location: '', note: '', durationHours: 2 })
  const [comeAudience, setComeAudience] = useState([])
  const [circleName, setCircleName] = useState('')
  const [circleAudience, setCircleAudience] = useState([])
  const [roomTitle, setRoomTitle] = useState('')
  const [roomAudience, setRoomAudience] = useState([])
  const [queueTitle, setQueueTitle] = useState('Shared queue')
  const [queueAudience, setQueueAudience] = useState([])
  const [song, setSong] = useState({ title: '', url: '' })

  const userId = session?.user?.id

  const people = useMemo(() => {
    const map = new Map()
    if (profile?.id) map.set(profile.id, profile)
    friends.forEach((friend) => map.set(friend.id, friend))
    return map
  }, [profile, friends])

  async function load(id = userId) {
    if (!id) return
    try {
      const [nextProfile, nextFriends, nextSnapshot] = await Promise.all([
        getProfile(id),
        getFriends(id),
        getTogetherSnapshot(id),
      ])
      setProfile(nextProfile)
      setFriends(nextFriends)
      setSnapshot(nextSnapshot)
    } catch (err) {
      console.error('[wavo together] load', err)
      setError('Could not refresh Together.')
    }
  }

  async function run(fn) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await fn()
      await load()
    } catch (err) {
      console.error('[wavo together]', err)
      setError(err?.message || 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return
      setSession(data?.session || null)
      if (data?.session?.user?.id) load(data.session.user.id)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!alive) return
      setSession(next)
      if (next?.user?.id) load(next.user.id)
      else setSnapshot(null)
    })
    return () => {
      alive = false
      listener?.subscription?.unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    if (!open || !userId) return undefined
    const timer = window.setInterval(() => load(userId), 15000)
    return () => window.clearInterval(timer)
  }, [open, userId])

  useEffect(() => {
    if (!friends.length) return
    const all = friends.map((friend) => friend.id)
    setComeAudience((current) => current.length ? current : all)
    setRoomAudience((current) => current.length ? current : all)
    setQueueAudience((current) => current.length ? current : all)
  }, [friends])

  if (!session) return null

  const ownStatus = snapshot?.statuses?.find((row) => row.user_id === userId)
  const friendStatuses = (snapshot?.statuses || []).filter((row) => row.user_id !== userId)
  const incomingKnocks = (snapshot?.knocks || []).filter((row) => row.receiver_id === userId && row.response === 'pending')
  const recentKnocks = (snapshot?.knocks || []).filter((row) => row.response !== 'pending').slice(0, 6)
  const activeInvites = (snapshot?.invites || []).filter((invite) => new Date(invite.ends_at) > new Date())
  const activeRooms = snapshot?.rooms || []
  const activeQueues = snapshot?.queues || []
  const games = snapshot?.games || []

  const weekCalls = (snapshot?.calls || []).filter((call) => call.status === 'ended')
  const weekCome = (snapshot?.invites || []).reduce((count, invite) => count + (invite.responses || []).filter((r) => r.user_id === userId && r.response === 'yep').length, 0)
  const weekKnocks = (snapshot?.knocks || []).filter((knock) => knock.sender_id === userId).length
  const weekGames = games.filter((game) => game.status === 'finished').length

  return (
    <>
      <button className="wt-launcher" onClick={() => setOpen(true)} aria-label="Open Wavo Together">
        <Sparkles size={18} /><span>Together</span>
        {incomingKnocks.length > 0 && <b>{incomingKnocks.length}</b>}
      </button>

      {open && (
        <div className="wt-layer" role="dialog" aria-modal="true" aria-label="Wavo Together">
          <div className="wt-sheet">
            <header className="wt-head">
              <div><span className="wt-kicker">WAVO TOGETHER</span><h2>Actually do stuff.</h2></div>
              <div className="wt-head-actions">
                <button onClick={() => load()} aria-label="Refresh"><RefreshCw size={18} /></button>
                <button onClick={() => setOpen(false)} aria-label="Close"><X size={20} /></button>
              </div>
            </header>

            <nav className="wt-tabs">
              {TABS.map(([id, label, Icon]) => (
                <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon size={16} /><span>{label}</span></button>
              ))}
            </nav>

            {error && <button className="wt-error" onClick={() => setError('')}>{error}<X size={15} /></button>}

            <main className="wt-content">
              {tab === 'now' && (
                <>
                  <section className="wt-hero-card">
                    <div><span className="wt-kicker">YOUR STATUS</span><h3>{ownStatus ? `${ownStatus.emoji || '⚡'} ${ownStatus.text}` : 'What are you doing?'}</h3>{ownStatus && <small>{timeLeft(ownStatus.expires_at)}</small>}</div>
                    {ownStatus && <button className="wt-ghost" onClick={() => run(() => clearExpiringStatus(userId))}>Clear</button>}
                  </section>

                  <section className="wt-card">
                    <div className="wt-section-title"><div><Radio size={18} /><strong>Expiring status</strong></div><span>Never gets stale</span></div>
                    <div className="wt-row-form">
                      <input value={statusText} onChange={(e) => setStatusText(e.target.value)} placeholder="At tennis 🎾" maxLength={120} />
                      <select value={statusHours} onChange={(e) => setStatusHours(Number(e.target.value))}>
                        <option value={1}>1h</option><option value={2}>2h</option><option value={4}>4h</option><option value={8}>8h</option>
                      </select>
                      <button className="wt-primary" disabled={busy || !statusText.trim()} onClick={() => run(async () => { await setExpiringStatus(userId, statusText, statusHours); setStatusText('') })}>Set</button>
                    </div>
                    {friendStatuses.length > 0 && <div className="wt-status-grid">{friendStatuses.map((status) => <div key={status.user_id}><Person person={people.get(status.user_id)} small /><span>{status.emoji || '⚡'} {status.text}</span><small>{timeLeft(status.expires_at)}</small></div>)}</div>}
                  </section>

                  <section className="wt-card">
                    <div className="wt-section-title"><div><Hand size={18} /><strong>Knock</strong></div><span>“free?” without a whole call</span></div>
                    {incomingKnocks.map((knock) => (
                      <div className="wt-knock-in" key={knock.id}>
                        <Person person={people.get(knock.sender_id)} />
                        <strong>knocked 👊</strong>
                        <div><button onClick={() => run(() => respondKnock(knock.id, 'call'))}>Call</button><button onClick={() => run(() => respondKnock(knock.id, 'five'))}>Give me 5</button><button onClick={() => run(() => respondKnock(knock.id, 'cant'))}>Can’t rn</button></div>
                      </div>
                    ))}
                    <div className="wt-friend-actions">
                      {friends.map((friend) => <button key={friend.id} onClick={() => run(() => sendKnock(userId, friend.id))}><Person person={friend} small /><span>Knock</span></button>)}
                    </div>
                    {recentKnocks.length > 0 && <div className="wt-mini-list">{recentKnocks.map((knock) => <span key={knock.id}>{knock.sender_id === userId ? 'You →' : '←'} {people.get(knock.sender_id === userId ? knock.receiver_id : knock.sender_id)?.username || 'friend'} · {knock.response === 'five' ? 'give me 5' : knock.response === 'cant' ? 'can’t rn' : 'call'}</span>)}</div>}
                  </section>

                  <section className="wt-card">
                    <div className="wt-section-title"><div><Users size={18} /><strong>Friend circles</strong></div><span>Set sharing groups once</span></div>
                    <div className="wt-row-form"><input value={circleName} onChange={(e) => setCircleName(e.target.value)} placeholder="School / Gaming / Best friends" /><button className="wt-primary" disabled={!circleName.trim()} onClick={() => run(async () => { await createFriendCircle(userId, { name: circleName, members: circleAudience }); setCircleName(''); setCircleAudience([]) })}><Plus size={16} />Create</button></div>
                    <AudiencePicker friends={friends} selected={circleAudience} setSelected={setCircleAudience} />
                    <div className="wt-chip-list">{(snapshot?.circles || []).map((circle) => <button key={circle.id} onClick={() => run(() => deleteFriendCircle(circle.id))}>{circle.emoji || '👥'} {circle.name} <small>{circle.members.length}</small> <X size={13} /></button>)}</div>
                  </section>
                </>
              )}

              {tab === 'come' && (
                <>
                  <section className="wt-hero-card wt-come-hero"><div><span className="wt-kicker">COME?</span><h3>Turn “we should do something” into something.</h3><small>Your selected friends get one tiny RSVP.</small></div><CalendarDays size={30} /></section>
                  <section className="wt-card">
                    <div className="wt-section-title"><div><Plus size={18} /><strong>Start a Come?</strong></div><span>Now-ish by default</span></div>
                    <div className="wt-form-grid">
                      <input value={come.title} onChange={(e) => setCome({ ...come, title: e.target.value })} placeholder="🏀 Basketball" />
                      <input value={come.location} onChange={(e) => setCome({ ...come, location: e.target.value })} placeholder="At the courts" />
                      <input value={come.note} onChange={(e) => setCome({ ...come, note: e.target.value })} placeholder="Optional note" />
                      <select value={come.durationHours} onChange={(e) => setCome({ ...come, durationHours: Number(e.target.value) })}><option value={1}>For 1 hour</option><option value={2}>For 2 hours</option><option value={4}>For 4 hours</option><option value={8}>For 8 hours</option></select>
                    </div>
                    <AudiencePicker friends={friends} selected={comeAudience} setSelected={setComeAudience} />
                    <button className="wt-big-primary" disabled={busy || !come.title.trim()} onClick={() => run(async () => { await createComeInvite(userId, { ...come, audience: comeAudience }); setCome({ title: '', location: '', note: '', durationHours: 2 }) })}>Post Come? <Sparkles size={17} /></button>
                  </section>

                  <section className="wt-stack">
                    {activeInvites.length === 0 && <Empty>No live Come? invites right now.</Empty>}
                    {activeInvites.map((invite) => {
                      const mine = invite.responses?.find((r) => r.user_id === userId)?.response
                      const yep = invite.responses?.filter((r) => r.response === 'yep').length || 0
                      return (
                        <article className="wt-come-card" key={invite.id}>
                          <div className="wt-come-top"><Person person={people.get(invite.owner_id)} small /><span>{timeLeft(invite.ends_at)}</span></div>
                          <h3>{invite.title}</h3>
                          {invite.location && <p><MapPin size={15} />{invite.location}</p>}
                          {invite.note && <small>{invite.note}</small>}
                          <strong>{yep} going</strong>
                          <div className="wt-rsvp"><button className={mine === 'yep' ? 'active' : ''} onClick={() => run(() => setComeResponse(invite.id, userId, 'yep'))}>Yep</button><button className={mine === 'maybe' ? 'active' : ''} onClick={() => run(() => setComeResponse(invite.id, userId, 'maybe'))}>Maybe</button><button className={mine === 'cant' ? 'active' : ''} onClick={() => run(() => setComeResponse(invite.id, userId, 'cant'))}>Can’t</button></div>
                        </article>
                      )
                    })}
                  </section>
                </>
              )}

              {tab === 'hangout' && (
                <>
                  <section className="wt-hero-card"><div><span className="wt-kicker">DROP-IN</span><h3>Rooms without the ringing ceremony.</h3><small>Join, leave, and see who is around.</small></div><Headphones size={30} /></section>
                  <section className="wt-card">
                    <div className="wt-section-title"><div><Headphones size={18} /><strong>Open a room</strong></div><span>Temporary by design</span></div>
                    <div className="wt-row-form"><input value={roomTitle} onChange={(e) => setRoomTitle(e.target.value)} placeholder="Gaming / Homework / Just talking" /><button className="wt-primary" disabled={!roomTitle.trim()} onClick={() => run(async () => { await createDropinRoom(userId, { title: roomTitle, audience: roomAudience }); setRoomTitle('') })}>Open</button></div>
                    <AudiencePicker friends={friends} selected={roomAudience} setSelected={setRoomAudience} />
                  </section>
                  <section className="wt-stack">
                    {activeRooms.length === 0 && <Empty>No drop-in rooms are open.</Empty>}
                    {activeRooms.map((room) => {
                      const joined = room.members?.some((m) => m.user_id === userId)
                      return <article className="wt-room-card" key={room.id}><div><Radio size={18} /><span><strong>{room.title}</strong><small>{room.members?.length || 0} in room · opened {relative(room.created_at)}</small></span></div><div>{room.owner_id === userId ? <button onClick={() => run(() => closeDropinRoom(room.id))}>Close</button> : <button className={joined ? 'active' : ''} onClick={() => run(() => setDropinMembership(room.id, userId, !joined))}>{joined ? 'Leave' : 'Join'}</button>}</div></article>
                    })}
                  </section>
                </>
              )}

              {tab === 'play' && (
                <>
                  <section className="wt-card">
                    <div className="wt-section-title"><div><Music2 size={18} /><strong>Shared queue</strong></div><span>Spotify links without surveillance</span></div>
                    <div className="wt-row-form"><input value={queueTitle} onChange={(e) => setQueueTitle(e.target.value)} placeholder="Tonight’s queue" /><button className="wt-primary" onClick={() => run(() => createSharedQueue(userId, { title: queueTitle, audience: queueAudience }))}>Start</button></div>
                    <AudiencePicker friends={friends} selected={queueAudience} setSelected={setQueueAudience} />
                    {activeQueues.map((queue) => (
                      <div className="wt-queue" key={queue.id}>
                        <div className="wt-queue-head"><strong>{queue.title}</strong><span>{queue.items?.length || 0} songs</span>{queue.owner_id === userId && <button onClick={() => run(() => closeSharedQueue(queue.id))}><X size={14} /></button>}</div>
                        <div className="wt-song-add"><input value={song.title} onChange={(e) => setSong({ ...song, title: e.target.value })} placeholder="Song name" /><input value={song.url} onChange={(e) => setSong({ ...song, url: e.target.value })} placeholder="Spotify link" /><button onClick={() => run(async () => { await addSharedQueueItem(queue.id, userId, song); setSong({ title: '', url: '' }) })}><Plus size={16} /></button></div>
                        <div className="wt-song-list">{(queue.items || []).map((item, index) => <button key={item.id} onClick={() => window.open(item.url, '_blank', 'noopener,noreferrer')}><span>{index + 1}</span><strong>{item.title}</strong><small>by {people.get(item.added_by)?.username || 'friend'}</small></button>)}</div>
                      </div>
                    ))}
                  </section>

                  <section className="wt-card">
                    <div className="wt-section-title"><div><Gamepad2 size={18} /><strong>Chat games</strong></div><span>Tiny games, zero separate app</span></div>
                    <div className="wt-game-starts">{friends.map((friend) => <div key={friend.id}><Person person={friend} small /><button onClick={() => run(() => startChatGame(userId, friend.id, 'rps'))}>RPS</button><button onClick={() => run(() => startChatGame(userId, friend.id, 'coin'))}>Coin</button></div>)}</div>
                    <div className="wt-games">{games.slice(0, 12).map((game) => {
                      const otherId = game.creator_id === userId ? game.opponent_id : game.creator_id
                      const result = game.kind === 'rps' ? rpsResult(game, userId) : game.state?.result
                      const myChoice = game.state?.choices?.[userId]
                      return <article key={game.id}><div><Person person={people.get(otherId)} small /><span>{game.kind === 'rps' ? 'Rock paper scissors' : 'Coin flip'}</span></div>{game.kind === 'rps' && game.status === 'active' ? <div className="wt-rps">{['rock','paper','scissors'].map((choice) => <button key={choice} className={myChoice === choice ? 'active' : ''} disabled={Boolean(myChoice)} onClick={() => run(() => playRps(game, userId, choice))}>{choice === 'rock' ? '🪨' : choice === 'paper' ? '📄' : '✂️'}</button>)}</div> : <strong className="wt-result">{game.kind === 'coin' ? (result === 'heads' ? '🪙 Heads' : '🪙 Tails') : result || 'Waiting…'}</strong>}</article>
                    })}</div>
                  </section>
                </>
              )}

              {tab === 'recap' && (
                <>
                  <section className="wt-hero-card"><div><span className="wt-kicker">PRIVATE WEEKLY RECAP</span><h3>Your Wavo week.</h3><small>Only activity Wavo already needs for these features.</small></div><Trophy size={30} /></section>
                  <div className="wt-stats"><div><Phone /><strong>{weekCalls}</strong><span>calls ended</span></div><div><CalendarDays /><strong>{weekCome}</strong><span>Come? yeses</span></div><div><Hand /><strong>{weekKnocks}</strong><span>knocks sent</span></div><div><Gamepad2 /><strong>{weekGames}</strong><span>games finished</span></div></div>
                  <section className="wt-card">
                    <div className="wt-section-title"><div><Clock3 size={18} /><strong>Recent calls</strong></div><span>continuity, not recordings</span></div>
                    <div className="wt-call-history">{(snapshot?.calls || []).slice(0, 12).map((call) => { const other = call.caller_id === userId ? call.callee_id : call.caller_id; return <div key={call.id}><Person person={people.get(other)} small /><span>{call.mode === 'video' ? 'Video' : 'Voice'} call</span><small>{call.status} · {relative(call.created_at)}</small></div> })}</div>
                    {(snapshot?.calls || []).length === 0 && <Empty>No recent calls yet.</Empty>}
                  </section>
                  <section className="wt-card wt-privacy"><Check size={18} /><div><strong>No call recording.</strong><span>Recap uses call metadata, RSVPs, knocks and games. Statuses still expire instead of becoming a permanent activity history.</span></div></section>
                </>
              )}
            </main>
          </div>
        </div>
      )}
    </>
  )
}
