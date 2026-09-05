import { useEffect, useMemo, useState } from 'react'
import {
  Clock3,
  Copy,
  Gamepad2,
  MapPin,
  Navigation,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
  X,
} from 'lucide-react'
import { supabase } from './supabaseClient'
import { getFriends, getProfile } from './wavoData'
import {
  getActiveTemporaryLocations,
  getPhase3Recap,
  playPhase3Game,
  shareTemporaryLocation,
  startPhase3Game,
  stopTemporaryLocation,
} from './phase3Data'
import './phase3.css'

const TABS = [
  ['meet', 'Meet', MapPin],
  ['games', 'Games', Gamepad2],
  ['recap', 'Recap', Trophy],
]

function Avatar({ person }) {
  const letter = String(person?.username || 'W').slice(0, 1).toUpperCase()
  return <span className="p3-avatar">{person?.avatar_url ? <img src={person.avatar_url} alt="" /> : letter}</span>
}

function relativeLeft(ts) {
  const mins = Math.max(0, Math.ceil((new Date(ts).getTime() - Date.now()) / 60000))
  if (mins < 60) return `${mins}m left`
  return `${Math.floor(mins / 60)}h ${mins % 60}m left`
}

function dayName(ts) {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(ts))
}

function gameLabel(kind) {
  return kind === 'tic_tac_toe' ? 'Tic Tac Toe' : kind === 'connect4' ? 'Connect 4' : kind
}

function gameStatus(game, userId, people) {
  const winner = game.state?.winner
  if (winner === 'draw') return 'Draw'
  if (winner) return winner === userId ? 'You won' : `${people.get(winner)?.username || 'Friend'} won`
  if (game.state?.turn === userId) return 'Your turn'
  return `${people.get(game.state?.turn)?.username || 'Friend'}’s turn`
}

function TicTacToe({ game, userId, onMove }) {
  const board = game.state?.board || Array(9).fill(null)
  const myTurn = game.status === 'active' && game.state?.turn === userId
  return (
    <div className="p3-ttt">
      {board.map((cell, index) => (
        <button key={index} disabled={!myTurn || Boolean(cell)} onClick={() => onMove(index)}>
          {cell === 'a' ? '✕' : cell === 'b' ? '○' : ''}
        </button>
      ))}
    </div>
  )
}

function Connect4({ game, userId, onMove }) {
  const board = game.state?.board || Array(42).fill(null)
  const myTurn = game.status === 'active' && game.state?.turn === userId
  return (
    <div className="p3-c4-wrap">
      <div className="p3-c4-drop">
        {Array.from({ length: 7 }).map((_, col) => <button key={col} disabled={!myTurn} onClick={() => onMove(col)}>↓</button>)}
      </div>
      <div className="p3-c4">
        {board.map((cell, index) => <span key={index} className={cell ? `filled ${cell}` : ''}>{cell === 'a' ? '●' : cell === 'b' ? '●' : '○'}</span>)}
      </div>
    </div>
  )
}

function buildRecap(raw, userId, people) {
  const calls = raw?.calls || []
  const games = raw?.games || []
  const knocks = raw?.knocks || []
  const responses = raw?.responses || []
  const messages = [...(raw?.dms || []), ...(raw?.spaceMessages || [])]
  const ended = calls.filter((call) => call.status === 'ended')
  const minutes = ended.reduce((total, call) => {
    const diff = new Date(call.updated_at).getTime() - new Date(call.created_at).getTime()
    return total + Math.max(0, Math.round(diff / 60000))
  }, 0)
  const interactions = new Map()
  const add = (id, amount = 1) => {
    if (!id || id === userId) return
    interactions.set(id, (interactions.get(id) || 0) + amount)
  }
  calls.forEach((call) => add(call.caller_id === userId ? call.callee_id : call.caller_id, 3))
  games.forEach((game) => add(game.creator_id === userId ? game.opponent_id : game.creator_id, 2))
  knocks.forEach((knock) => add(knock.sender_id === userId ? knock.receiver_id : knock.sender_id, 1))
  const topId = [...interactions.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]

  const days = new Map()
  const addDay = (ts) => {
    if (!ts) return
    const key = dayName(ts)
    days.set(key, (days.get(key) || 0) + 1)
  }
  ;[...calls, ...games, ...knocks, ...messages].forEach((row) => addDay(row.created_at))
  const busiest = [...days.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'Quiet week'
  const wins = games.filter((game) => game.status === 'finished' && game.state?.winner === userId).length
  return {
    calls: ended.length,
    minutes,
    games: games.filter((game) => game.status === 'finished').length,
    wins,
    messages: messages.length,
    yeses: responses.filter((r) => r.response === 'yep').length,
    topPerson: people.get(topId),
    busiest,
  }
}

export default function Phase3Hub() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [friends, setFriends] = useState([])
  const [locations, setLocations] = useState([])
  const [games, setGames] = useState([])
  const [recapRaw, setRecapRaw] = useState(null)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('meet')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [locationLabel, setLocationLabel] = useState('I’m here')
  const [locationMinutes, setLocationMinutes] = useState(30)
  const [approximate, setApproximate] = useState(true)
  const [audience, setAudience] = useState([])
  const [gameFriend, setGameFriend] = useState('')

  const userId = session?.user?.id
  const people = useMemo(() => {
    const map = new Map()
    if (profile?.id) map.set(profile.id, profile)
    friends.forEach((friend) => map.set(friend.id, friend))
    return map
  }, [profile, friends])
  const recap = useMemo(() => buildRecap(recapRaw, userId, people), [recapRaw, userId, people])

  async function load(id = userId) {
    if (!id) return
    const [nextProfile, nextFriends, nextLocations, nextRecap] = await Promise.all([
      getProfile(id),
      getFriends(id),
      getActiveTemporaryLocations(),
      getPhase3Recap(id),
    ])
    setProfile(nextProfile)
    setFriends(nextFriends)
    setLocations(nextLocations)
    setGames((nextRecap.games || []).filter((game) => ['tic_tac_toe', 'connect4'].includes(game.kind)))
    setRecapRaw(nextRecap)
    setAudience((current) => current.length ? current : nextFriends.map((friend) => friend.id))
    setGameFriend((current) => current || nextFriends[0]?.id || '')
  }

  async function run(fn) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await fn()
      await load()
    } catch (err) {
      console.error('[wavo phase3]', err)
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
      if (data?.session?.user?.id) load(data.session.user.id).catch(() => {})
    })
    const { data: auth } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!alive) return
      setSession(next)
      if (next?.user?.id) load(next.user.id).catch(() => {})
    })
    return () => {
      alive = false
      auth?.subscription?.unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    if (!open || !userId) return undefined
    const timer = window.setInterval(() => load(userId).catch(() => {}), 12000)
    const channel = supabase
      .channel(`wavo-phase3:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'temporary_location_shares' }, () => load(userId).catch(() => {}))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_games' }, () => load(userId).catch(() => {}))
      .subscribe()
    return () => {
      window.clearInterval(timer)
      supabase.removeChannel(channel)
    }
  }, [open, userId])

  if (!session) return null
  const ownLocation = locations.find((row) => row.owner_id === userId)

  function toggleAudience(id) {
    setAudience((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  }

  function shareHere() {
    if (!navigator.geolocation) {
      setError('Location is not available on this device.')
      return
    }
    setBusy(true)
    setError('')
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        const rawLat = pos.coords.latitude
        const rawLng = pos.coords.longitude
        const latitude = approximate ? Math.round(rawLat * 1000) / 1000 : rawLat
        const longitude = approximate ? Math.round(rawLng * 1000) / 1000 : rawLng
        await shareTemporaryLocation(userId, {
          audience,
          label: locationLabel,
          latitude,
          longitude,
          precisionM: approximate ? Math.max(150, Math.round(pos.coords.accuracy || 150)) : Math.max(5, Math.round(pos.coords.accuracy || 20)),
          approximate,
          minutes: locationMinutes,
        })
        await load()
      } catch (err) {
        setError(err?.message || 'Could not share location.')
      } finally {
        setBusy(false)
      }
    }, () => {
      setBusy(false)
      setError('Location permission was not granted.')
    }, { enableHighAccuracy: !approximate, timeout: 12000, maximumAge: 15000 })
  }

  async function copyRecap() {
    const top = recap.topPerson ? ` Top person: @${recap.topPerson.username}.` : ''
    const text = `My Wavo week: ${recap.calls} calls, ${recap.minutes} call minutes, ${recap.messages} messages, ${recap.games} games, ${recap.wins} wins.${top}`
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      setError('Could not copy the recap.')
    }
  }

  return (
    <>
      <button className="p3-launcher" onClick={() => setOpen(true)} aria-label="Open Wavo Batch 3">
        <Sparkles size={17} /><span>More</span>
      </button>

      {open && (
        <div className="p3-layer" role="dialog" aria-modal="true" aria-label="Wavo Meet Games and Recap">
          <div className="p3-sheet">
            <header className="p3-head">
              <div><span>WAVO+</span><h2>Meet. Play. Remember.</h2></div>
              <div><button onClick={() => load()} aria-label="Refresh"><RefreshCw size={18} /></button><button onClick={() => setOpen(false)} aria-label="Close"><X size={19} /></button></div>
            </header>
            <nav className="p3-tabs">
              {TABS.map(([id, label, Icon]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon size={16} />{label}</button>)}
            </nav>
            {error && <button className="p3-error" onClick={() => setError('')}>{error}<X size={14} /></button>}

            <main className="p3-content">
              {tab === 'meet' && (
                <>
                  <section className="p3-hero"><div><span>TEMPORARY LOCATION</span><h3>“I’m here” without becoming a tracking app.</h3><p>Pick the people, pick the timer, then it disappears.</p></div><MapPin size={30} /></section>
                  <section className="p3-card">
                    <div className="p3-title"><div><Navigation size={18} /><strong>Share where you are</strong></div><small>{ownLocation ? relativeLeft(ownLocation.expires_at) : 'Off'}</small></div>
                    <div className="p3-location-form">
                      <input value={locationLabel} onChange={(e) => setLocationLabel(e.target.value)} maxLength={80} placeholder="At the courts" />
                      <select value={locationMinutes} onChange={(e) => setLocationMinutes(Number(e.target.value))}><option value={15}>15 min</option><option value={30}>30 min</option><option value={60}>1 hour</option><option value={120}>2 hours</option></select>
                    </div>
                    <button className={`p3-precision ${approximate ? 'active' : ''}`} onClick={() => setApproximate((value) => !value)}><ShieldCheck size={16} /><span><strong>{approximate ? 'Approximate area' : 'Precise point'}</strong><small>{approximate ? 'Rounded before Wavo stores it.' : 'Only selected friends can see it.'}</small></span></button>
                    <div className="p3-audience">
                      {friends.map((friend) => <button key={friend.id} className={audience.includes(friend.id) ? 'selected' : ''} onClick={() => toggleAudience(friend.id)}><Avatar person={friend} /><span>{friend.username}</span><b>{audience.includes(friend.id) ? '✓' : '+'}</b></button>)}
                    </div>
                    <div className="p3-actions"><button className="primary" disabled={busy || !audience.length} onClick={shareHere}>{ownLocation ? 'Update location' : 'Share here'}</button>{ownLocation && <button onClick={() => run(() => stopTemporaryLocation(userId))}>Stop now</button>}</div>
                  </section>
                  <section className="p3-stack">
                    {locations.filter((row) => row.owner_id !== userId).map((row) => {
                      const person = people.get(row.owner_id)
                      const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${row.latitude},${row.longitude}`)}`
                      return <article className="p3-location" key={row.owner_id}><Avatar person={person} /><div><strong>@{person?.username || 'friend'} · {row.label}</strong><span>{row.approximate ? 'Approximate area' : 'Precise location'} · {relativeLeft(row.expires_at)}</span></div><button onClick={() => window.open(mapUrl, '_blank', 'noopener,noreferrer')}><MapPin size={16} />Map</button></article>
                    })}
                    {!locations.some((row) => row.owner_id !== userId) && <div className="p3-empty"><MapPin size={18} />No friends are temporarily sharing a location with you.</div>}
                  </section>
                </>
              )}

              {tab === 'games' && (
                <>
                  <section className="p3-hero"><div><span>CHAT GAMES 2.0</span><h3>Actual tiny games now.</h3><p>Tic Tac Toe and Connect 4 live beside RPS and Coin.</p></div><Gamepad2 size={30} /></section>
                  <section className="p3-card">
                    <div className="p3-title"><div><Users size={18} /><strong>Challenge a friend</strong></div></div>
                    <select className="p3-friend-select" value={gameFriend} onChange={(e) => setGameFriend(e.target.value)}><option value="">Choose friend</option>{friends.map((friend) => <option key={friend.id} value={friend.id}>@{friend.username}</option>)}</select>
                    <div className="p3-game-buttons"><button disabled={!gameFriend || busy} onClick={() => run(() => startPhase3Game(userId, gameFriend, 'tic_tac_toe'))}>✕ ○ Tic Tac Toe</button><button disabled={!gameFriend || busy} onClick={() => run(() => startPhase3Game(userId, gameFriend, 'connect4'))}>🔴 🟡 Connect 4</button></div>
                  </section>
                  <section className="p3-stack">
                    {games.slice(0, 16).map((game) => {
                      const otherId = game.creator_id === userId ? game.opponent_id : game.creator_id
                      const other = people.get(otherId)
                      return <article className="p3-game" key={game.id}><div className="p3-game-head"><div><Avatar person={other} /><span><strong>{gameLabel(game.kind)}</strong><small>vs @{other?.username || 'friend'}</small></span></div><b>{gameStatus(game, userId, people)}</b></div>{game.kind === 'tic_tac_toe' ? <TicTacToe game={game} userId={userId} onMove={(move) => run(() => playPhase3Game(game.id, userId, move))} /> : <Connect4 game={game} userId={userId} onMove={(move) => run(() => playPhase3Game(game.id, userId, move))} />}</article>
                    })}
                    {!games.length && <div className="p3-empty"><Gamepad2 size={18} />No board games yet. Challenge someone.</div>}
                  </section>
                </>
              )}

              {tab === 'recap' && (
                <>
                  <section className="p3-hero"><div><span>PRIVATE WEEKLY RECAP</span><h3>Your week, with a little more personality.</h3><p>No call recordings and no permanent location history.</p></div><Trophy size={30} /></section>
                  <div className="p3-stats"><div><strong>{recap.calls}</strong><span>calls</span></div><div><strong>{recap.minutes}</strong><span>call min</span></div><div><strong>{recap.messages}</strong><span>messages</span></div><div><strong>{recap.wins}/{recap.games}</strong><span>game wins</span></div></div>
                  <section className="p3-card p3-recap-main">
                    <div className="p3-title"><div><Sparkles size={18} /><strong>Week highlights</strong></div><button onClick={copyRecap}><Copy size={15} />Copy</button></div>
                    <div className="p3-highlight"><span>👥</span><div><small>Most connected with</small><strong>{recap.topPerson ? `@${recap.topPerson.username}` : 'No clear winner yet'}</strong></div></div>
                    <div className="p3-highlight"><span>⚡</span><div><small>Busiest Wavo day</small><strong>{recap.busiest}</strong></div></div>
                    <div className="p3-highlight"><span>📍</span><div><small>Come? yeses</small><strong>{recap.yeses}</strong></div></div>
                  </section>
                  <section className="p3-card p3-privacy"><ShieldCheck size={19} /><div><strong>Recap stays private by default.</strong><span>It is calculated from metadata Wavo already has for calls, messages, Come?, knocks and games. Temporary location rows expire and are not used for this recap.</span></div></section>
                </>
              )}
            </main>
          </div>
        </div>
      )}
    </>
  )
}
