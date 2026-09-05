import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Mic, MicOff, PhoneOff, Users, Video, VideoOff } from 'lucide-react'
import { supabase } from './supabaseClient'
import { getSpaces } from './wavoData'
import './group-video-calls.css'

const MAX_PARTICIPANTS = 6
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

function initial(profile) {
  return String(profile?.username || 'W').trim().slice(0, 1).toUpperCase()
}

function RemoteTile({ stream, profile }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current && stream) ref.current.srcObject = stream
  }, [stream])
  return (
    <div className="wavo-group-video-tile">
      <video ref={ref} autoPlay playsInline />
      <span>{profile?.username || 'Wavo member'}</span>
    </div>
  )
}

export default function GroupVideoCalls() {
  const [userId, setUserId] = useState(null)
  const [selectedSpace, setSelectedSpace] = useState(null)
  const [portalTarget, setPortalTarget] = useState(null)
  const [activeRoom, setActiveRoom] = useState(null)
  const [roomCount, setRoomCount] = useState(0)
  const [joinedRoom, setJoinedRoom] = useState(null)
  const [localStream, setLocalStream] = useState(null)
  const [peerIds, setPeerIds] = useState([])
  const [profiles, setProfiles] = useState({})
  const [muted, setMuted] = useState(false)
  const [cameraOff, setCameraOff] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const localVideoRef = useRef(null)
  const channelRef = useRef(null)
  const streamRef = useRef(null)
  const peersRef = useRef(new Map())
  const streamsRef = useRef(new Map())
  const candidatesRef = useRef(new Map())
  const heartbeatRef = useRef(null)
  const joinedRoomRef = useRef(null)
  const userIdRef = useRef(null)

  useEffect(() => { joinedRoomRef.current = joinedRoom }, [joinedRoom])
  useEffect(() => { userIdRef.current = userId }, [userId])

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(({ data }) => {
      if (alive) setUserId(data?.session?.user?.id || null)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!alive) return
      setUserId(session?.user?.id || null)
    })
    return () => {
      alive = false
      listener?.subscription?.unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    if (!userId) return undefined
    let disposed = false
    let lastName = ''

    async function syncSpace() {
      const hero = document.querySelector('.space-hero')
      const target = document.querySelector('.space-hero + .quick-actions') || document.querySelector('.quick-actions')
      const name = hero?.querySelector('h1')?.textContent?.trim() || ''
      if (!name || !target) {
        if (!disposed) {
          setPortalTarget(null)
          setSelectedSpace(null)
          lastName = ''
        }
        return
      }

      setPortalTarget(target)
      if (name === lastName) return
      lastName = name
      try {
        const spaces = await getSpaces(userId)
        if (disposed) return
        const matches = (spaces || []).filter((space) => space.name === name)
        setSelectedSpace(matches[0] || null)
      } catch (err) {
        console.warn('[wavo group call] could not resolve Space', err)
      }
    }

    const observer = new MutationObserver(() => syncSpace().catch(() => {}))
    observer.observe(document.body, { childList: true, subtree: true })
    syncSpace().catch(() => {})
    return () => {
      disposed = true
      observer.disconnect()
    }
  }, [userId])

  async function findActiveRoom(spaceId) {
    if (!spaceId) return null
    const { data, error: roomError } = await supabase
      .from('group_call_rooms')
      .select('*')
      .eq('group_id', spaceId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (roomError) throw roomError
    if (!data) return null
    if (new Date(data.expires_at).getTime() <= Date.now()) {
      await supabase.from('group_call_rooms').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', data.id).eq('status', 'active')
      return null
    }
    return data
  }

  async function refreshRoom(spaceId = selectedSpace?.id) {
    if (!spaceId) {
      setActiveRoom(null)
      setRoomCount(0)
      return
    }
    try {
      const room = await findActiveRoom(spaceId)
      setActiveRoom(room)
      if (!room) {
        setRoomCount(0)
        return
      }
      const { count } = await supabase
        .from('group_call_members')
        .select('room_id', { count: 'exact', head: true })
        .eq('room_id', room.id)
      setRoomCount(count || 0)
    } catch (err) {
      const message = String(err?.message || '')
      if (!message.includes('group_call_rooms')) console.warn('[wavo group call] refresh', err)
    }
  }

  useEffect(() => {
    if (!selectedSpace?.id) {
      if (!joinedRoomRef.current) {
        setActiveRoom(null)
        setRoomCount(0)
      }
      return undefined
    }
    let disposed = false
    refreshRoom(selectedSpace.id)
    const timer = window.setInterval(() => {
      if (!disposed) refreshRoom(selectedSpace.id)
    }, 4000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [selectedSpace?.id])

  useEffect(() => {
    if (localVideoRef.current && localStream) localVideoRef.current.srcObject = localStream
  }, [localStream, joinedRoom])

  async function ensureRealtimeAuth() {
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (token && supabase.realtime?.setAuth) await supabase.realtime.setAuth(token)
  }

  async function ensureProfile(peerId) {
    if (!peerId || profiles[peerId]) return
    const { data } = await supabase.from('profiles').select('id,username,avatar_url').eq('id', peerId).maybeSingle()
    if (data) setProfiles((current) => ({ ...current, [peerId]: data }))
  }

  function syncPeerIds() {
    setPeerIds([...streamsRef.current.keys()])
  }

  function removePeer(peerId) {
    const pc = peersRef.current.get(peerId)
    if (pc) {
      try { pc.close() } catch {}
      peersRef.current.delete(peerId)
    }
    streamsRef.current.delete(peerId)
    candidatesRef.current.delete(peerId)
    syncPeerIds()
  }

  async function send(payload) {
    const channel = channelRef.current
    const me = userIdRef.current
    if (!channel || !me) return
    await channel.send({ type: 'broadcast', event: 'group-signal', payload: { ...payload, from: me } })
  }

  function getPeer(peerId) {
    if (peersRef.current.has(peerId)) return peersRef.current.get(peerId)
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    peersRef.current.set(peerId, pc)

    for (const track of streamRef.current?.getTracks?.() || []) pc.addTrack(track, streamRef.current)

    pc.onicecandidate = (event) => {
      if (event.candidate) send({ type: 'candidate', target: peerId, candidate: event.candidate.toJSON() }).catch(() => {})
    }
    pc.ontrack = (event) => {
      const stream = event.streams?.[0]
      if (!stream) return
      streamsRef.current.set(peerId, stream)
      syncPeerIds()
      ensureProfile(peerId).catch(() => {})
    }
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState)) removePeer(peerId)
    }
    return pc
  }

  async function flushCandidates(peerId, pc) {
    if (!pc.remoteDescription) return
    const queue = candidatesRef.current.get(peerId) || []
    candidatesRef.current.set(peerId, [])
    for (const candidate of queue) {
      try { await pc.addIceCandidate(candidate) } catch {}
    }
  }

  async function offer(peerId, iceRestart = false) {
    const pc = getPeer(peerId)
    if (pc.signalingState !== 'stable') return
    const desc = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true, iceRestart })
    await pc.setLocalDescription(desc)
    await send({ type: 'offer', target: peerId, sdp: pc.localDescription })
  }

  async function handleSignal(payload) {
    const me = userIdRef.current
    if (!payload?.type || !me || payload.from === me) return
    if (payload.target && payload.target !== me) return
    const peerId = payload.from
    ensureProfile(peerId).catch(() => {})

    if (payload.type === 'hello') {
      if (String(me).localeCompare(String(peerId)) < 0) await offer(peerId)
      else await send({ type: 'hello-ack', target: peerId })
      return
    }
    if (payload.type === 'hello-ack') {
      if (String(me).localeCompare(String(peerId)) < 0) await offer(peerId)
      return
    }
    if (payload.type === 'leave') {
      removePeer(peerId)
      return
    }

    const pc = getPeer(peerId)
    if (payload.type === 'offer') {
      if (pc.signalingState !== 'stable') {
        try { await pc.setLocalDescription({ type: 'rollback' }) } catch {}
      }
      await pc.setRemoteDescription(payload.sdp)
      await flushCandidates(peerId, pc)
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      await send({ type: 'answer', target: peerId, sdp: pc.localDescription })
      return
    }
    if (payload.type === 'answer' && pc.signalingState === 'have-local-offer') {
      await pc.setRemoteDescription(payload.sdp)
      await flushCandidates(peerId, pc)
      return
    }
    if (payload.type === 'candidate' && payload.candidate) {
      if (pc.remoteDescription) {
        try { await pc.addIceCandidate(payload.candidate) } catch {}
      } else {
        const queue = candidatesRef.current.get(peerId) || []
        queue.push(payload.candidate)
        candidatesRef.current.set(peerId, queue)
      }
    }
  }

  async function leaveJoinedRoom({ silent = false } = {}) {
    const room = joinedRoomRef.current
    const me = userIdRef.current
    if (!room || !me) return

    if (!silent) send({ type: 'leave' }).catch(() => {})
    if (heartbeatRef.current) {
      window.clearInterval(heartbeatRef.current)
      heartbeatRef.current = null
    }
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }
    peersRef.current.forEach((_, peerId) => removePeer(peerId))
    streamRef.current?.getTracks?.().forEach((track) => track.stop())
    streamRef.current = null
    setLocalStream(null)
    setMuted(false)
    setCameraOff(false)
    setJoinedRoom(null)
    joinedRoomRef.current = null

    try {
      await supabase.from('group_call_members').delete().eq('room_id', room.id).eq('user_id', me)
      const { count } = await supabase
        .from('group_call_members')
        .select('room_id', { count: 'exact', head: true })
        .eq('room_id', room.id)
      if (!count) {
        await supabase.from('group_call_rooms').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', room.id).eq('status', 'active')
      }
    } catch (err) {
      console.warn('[wavo group call] leave metadata', err)
    }
    refreshRoom(room.group_id)
  }

  async function joinRoom(room) {
    const me = userIdRef.current
    if (!room?.id || !me || joinedRoomRef.current) return
    setBusy(true)
    setError('')
    try {
      const { count } = await supabase
        .from('group_call_members')
        .select('room_id', { count: 'exact', head: true })
        .eq('room_id', room.id)
      if ((count || 0) >= MAX_PARTICIPANTS) throw new Error('This group call already has 6 people.')

      await supabase.from('group_call_members').delete().eq('room_id', room.id).eq('user_id', me)
      const { error: memberError } = await supabase.from('group_call_members').insert({ room_id: room.id, user_id: me })
      if (memberError) throw memberError

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 540 } },
      })
      streamRef.current = stream
      setLocalStream(stream)
      setJoinedRoom(room)
      joinedRoomRef.current = room

      await ensureRealtimeAuth()
      const channel = supabase.channel(`wavo-group-call:${room.id}`, {
        config: { private: true, broadcast: { self: false } },
      })
      channelRef.current = channel
      channel.on('broadcast', { event: 'group-signal' }, ({ payload }) => {
        handleSignal(payload).catch((err) => console.warn('[wavo group call] signal', err))
      })
      channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await send({ type: 'hello' })
          heartbeatRef.current = window.setInterval(() => send({ type: 'hello' }).catch(() => {}), 7000)
        }
        if (['CHANNEL_ERROR', 'TIMED_OUT'].includes(status)) setError('Group call connection was interrupted.')
      })
      setRoomCount(Math.max(1, count || 0))
    } catch (err) {
      console.error('[wavo group call] join', err)
      setError(err?.message || 'Could not join the group call.')
      if (joinedRoomRef.current) await leaveJoinedRoom({ silent: true })
    } finally {
      setBusy(false)
    }
  }

  async function startOrJoin() {
    if (!selectedSpace?.id || busy) return
    if (activeRoom) return joinRoom(activeRoom)
    setBusy(true)
    setError('')
    try {
      let room = await findActiveRoom(selectedSpace.id)
      if (!room) {
        const { data, error: createError } = await supabase
          .from('group_call_rooms')
          .insert({ group_id: selectedSpace.id, created_by: userId, status: 'active' })
          .select('*')
          .single()
        if (createError) {
          if (createError.code === '23505') room = await findActiveRoom(selectedSpace.id)
          else throw createError
        } else room = data
      }
      if (!room) throw new Error('Could not create the group call.')
      setActiveRoom(room)
      setBusy(false)
      await joinRoom(room)
    } catch (err) {
      console.error('[wavo group call] start', err)
      setError(err?.message || 'Could not start the group call.')
      setBusy(false)
    }
  }

  function toggleMute() {
    const next = !muted
    streamRef.current?.getAudioTracks?.().forEach((track) => { track.enabled = !next })
    setMuted(next)
  }

  function toggleCamera() {
    const next = !cameraOff
    streamRef.current?.getVideoTracks?.().forEach((track) => { track.enabled = !next })
    setCameraOff(next)
  }

  useEffect(() => () => {
    if (joinedRoomRef.current) leaveJoinedRoom({ silent: true }).catch(() => {})
  }, [])

  const launcher = portalTarget && selectedSpace && !joinedRoom
    ? createPortal(
        <button className={`wavo-group-call-launch${activeRoom ? ' is-live' : ''}`} onClick={startOrJoin} disabled={busy}>
          <Video size={18} />
          <span>{busy ? 'Opening…' : activeRoom ? `Join call${roomCount ? ` · ${roomCount}` : ''}` : 'Video call'}</span>
        </button>,
        portalTarget,
      )
    : null

  const remoteTiles = peerIds.map((peerId) => (
    <RemoteTile key={peerId} stream={streamsRef.current.get(peerId)} profile={profiles[peerId]} />
  ))

  return (
    <>
      {launcher}
      {joinedRoom && (
        <div className="wavo-group-video-layer" role="dialog" aria-modal="true" aria-label="Group video call">
          <header>
            <div><span>SPACE VIDEO CALL</span><strong>{selectedSpace?.name || 'Wavo Space'}</strong><small><Users size={13} /> {peerIds.length + 1} connected · up to {MAX_PARTICIPANTS}</small></div>
            {error && <p>{error}</p>}
          </header>

          <div className={`wavo-group-video-grid peers-${Math.min(MAX_PARTICIPANTS, peerIds.length + 1)}`}>
            <div className="wavo-group-video-tile local">
              <video ref={localVideoRef} autoPlay muted playsInline />
              {cameraOff && <div className="wavo-group-video-avatar">{initial(profiles[userId])}</div>}
              <span>You</span>
            </div>
            {remoteTiles}
            {peerIds.length === 0 && <div className="wavo-group-video-wait"><Users size={28} /><strong>Waiting for the crew</strong><span>Anyone in this Space can join from the call button.</span></div>}
          </div>

          <div className="wavo-group-video-controls">
            <button className={muted ? 'is-off' : ''} onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>{muted ? <MicOff /> : <Mic />}</button>
            <button className={cameraOff ? 'is-off' : ''} onClick={toggleCamera} aria-label={cameraOff ? 'Turn camera on' : 'Turn camera off'}>{cameraOff ? <VideoOff /> : <Video />}</button>
            <button className="hangup" onClick={() => leaveJoinedRoom()} aria-label="Leave group call"><PhoneOff /></button>
          </div>
        </div>
      )}
      {!joinedRoom && error && <button className="wavo-group-call-error" onClick={() => setError('')}>{error}</button>}
    </>
  )
}
