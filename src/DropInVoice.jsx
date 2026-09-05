import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff, PhoneOff, Radio } from 'lucide-react'
import { supabase } from './supabaseClient'
import './dropin-voice.css'

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

function withTurn() {
  const urls = String(import.meta.env.VITE_TURN_URL || '').trim()
  if (!urls) return ICE_SERVERS
  return [
    ...ICE_SERVERS,
    {
      urls: urls.includes(',') ? urls.split(',').map((value) => value.trim()).filter(Boolean) : urls,
      username: String(import.meta.env.VITE_TURN_USERNAME || '').trim() || undefined,
      credential: String(import.meta.env.VITE_TURN_CREDENTIAL || '').trim() || undefined,
    },
  ]
}

export default function DropInVoice() {
  const [userId, setUserId] = useState(null)
  const [room, setRoom] = useState(null)
  const [muted, setMuted] = useState(false)
  const [connections, setConnections] = useState(0)
  const [error, setError] = useState('')

  const roomRef = useRef(null)
  const streamRef = useRef(null)
  const channelRef = useRef(null)
  const peersRef = useRef(new Map())
  const audioRef = useRef(new Map())
  const candidatesRef = useRef(new Map())

  useEffect(() => { roomRef.current = room }, [room])

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(({ data }) => {
      if (alive) setUserId(data?.session?.user?.id || null)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!alive) return
      setUserId(next?.user?.id || null)
      if (!next?.user) setRoom(null)
    })
    return () => {
      alive = false
      listener?.subscription?.unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    if (!userId) return undefined
    let cancelled = false

    async function findRoom() {
      const { data: memberships, error: membershipError } = await supabase
        .from('dropin_room_members')
        .select('room_id,joined_at')
        .eq('user_id', userId)
        .order('joined_at', { ascending: false })
        .limit(5)
      if (cancelled || membershipError) return
      const ids = (memberships || []).map((row) => row.room_id)
      if (!ids.length) {
        if (roomRef.current) setRoom(null)
        return
      }
      const { data: rooms } = await supabase
        .from('dropin_rooms')
        .select('id,title,is_open')
        .in('id', ids)
        .eq('is_open', true)
      if (cancelled) return
      const byId = new Map((rooms || []).map((item) => [item.id, item]))
      const next = (memberships || []).map((item) => byId.get(item.room_id)).find(Boolean) || null
      if (next?.id !== roomRef.current?.id) setRoom(next)
    }

    findRoom()
    const timer = window.setInterval(findRoom, 3000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [userId])

  useEffect(() => {
    if (!room?.id || !userId) return undefined
    let disposed = false
    let heartbeat = null

    async function ensureAuth() {
      const { data } = await supabase.auth.getSession()
      const token = data?.session?.access_token
      if (token && supabase.realtime?.setAuth) await supabase.realtime.setAuth(token)
    }

    function updateCount() {
      setConnections([...peersRef.current.values()].filter((pc) => pc.connectionState === 'connected').length)
    }

    function removePeer(peerId) {
      const pc = peersRef.current.get(peerId)
      if (pc) {
        try { pc.close() } catch {}
        peersRef.current.delete(peerId)
      }
      const audio = audioRef.current.get(peerId)
      if (audio) {
        try { audio.pause() } catch {}
        audio.srcObject = null
        audio.remove()
        audioRef.current.delete(peerId)
      }
      candidatesRef.current.delete(peerId)
      updateCount()
    }

    async function send(payload) {
      if (!channelRef.current) return
      await channelRef.current.send({ type: 'broadcast', event: 'voice', payload: { ...payload, from: userId } })
    }

    function getPeer(peerId) {
      if (peersRef.current.has(peerId)) return peersRef.current.get(peerId)
      const pc = new RTCPeerConnection({ iceServers: withTurn() })
      peersRef.current.set(peerId, pc)
      for (const track of streamRef.current?.getAudioTracks?.() || []) pc.addTrack(track, streamRef.current)

      pc.onicecandidate = (event) => {
        if (event.candidate) send({ type: 'candidate', target: peerId, candidate: event.candidate.toJSON() }).catch(() => {})
      }
      pc.ontrack = (event) => {
        const stream = event.streams?.[0]
        if (!stream) return
        let audio = audioRef.current.get(peerId)
        if (!audio) {
          audio = document.createElement('audio')
          audio.autoplay = true
          audio.playsInline = true
          audio.setAttribute('data-wavo-room-peer', peerId)
          audio.style.display = 'none'
          document.body.appendChild(audio)
          audioRef.current.set(peerId, audio)
        }
        audio.srcObject = stream
        audio.play?.().catch(() => {})
      }
      pc.onconnectionstatechange = () => {
        updateCount()
        if (['failed', 'closed'].includes(pc.connectionState)) removePeer(peerId)
      }
      return pc
    }

    async function flush(peerId, pc) {
      if (!pc.remoteDescription) return
      const queue = candidatesRef.current.get(peerId) || []
      candidatesRef.current.set(peerId, [])
      for (const candidate of queue) {
        try { await pc.addIceCandidate(candidate) } catch {}
      }
    }

    async function offer(peerId) {
      const pc = getPeer(peerId)
      if (pc.signalingState !== 'stable') return
      const desc = await pc.createOffer({ offerToReceiveAudio: true })
      await pc.setLocalDescription(desc)
      await send({ type: 'offer', target: peerId, sdp: pc.localDescription })
    }

    async function handle(payload) {
      if (!payload?.type || payload.from === userId) return
      if (payload.target && payload.target !== userId) return
      const peerId = payload.from

      if (payload.type === 'hello') {
        if (String(userId).localeCompare(String(peerId)) < 0) await offer(peerId)
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
        await flush(peerId, pc)
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        await send({ type: 'answer', target: peerId, sdp: pc.localDescription })
        return
      }
      if (payload.type === 'answer' && pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(payload.sdp)
        await flush(peerId, pc)
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

    async function start() {
      setError('')
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        if (disposed) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        await ensureAuth()
        const channel = supabase.channel(`wavo-room:${room.id}`, {
          config: { private: true, broadcast: { self: false } },
        })
        channelRef.current = channel
        channel.on('broadcast', { event: 'voice' }, ({ payload }) => {
          handle(payload).catch((err) => console.warn('[wavo room] signal', err))
        })
        channel.subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            await send({ type: 'hello' })
            heartbeat = window.setInterval(() => send({ type: 'hello' }).catch(() => {}), 9000)
          }
          if (['CHANNEL_ERROR', 'TIMED_OUT'].includes(status)) setError('Room connection lost.')
        })
      } catch (err) {
        console.error('[wavo room] start', err)
        setError(String(err?.message || '').toLowerCase().includes('permission') ? 'Microphone permission is needed for this room.' : 'Could not connect room audio.')
      }
    }

    start()

    return () => {
      disposed = true
      if (heartbeat) window.clearInterval(heartbeat)
      send({ type: 'leave' }).catch(() => {})
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
      peersRef.current.forEach((_, peerId) => removePeer(peerId))
      streamRef.current?.getTracks?.().forEach((track) => track.stop())
      streamRef.current = null
      setConnections(0)
      setMuted(false)
    }
  }, [room?.id, userId])

  function toggleMute() {
    const next = !muted
    streamRef.current?.getAudioTracks?.().forEach((track) => { track.enabled = !next })
    setMuted(next)
  }

  async function leaveRoom() {
    if (!room?.id || !userId) return
    await supabase.from('dropin_room_members').delete().eq('room_id', room.id).eq('user_id', userId)
    setRoom(null)
  }

  if (!room) return null

  return (
    <aside className="dropin-voice-bar" aria-label="Drop-in voice room">
      <span className="dropin-live-dot" />
      <div className="dropin-copy"><strong>{room.title}</strong><small>{error || `${connections + 1} connected · live voice`}</small></div>
      <button className={muted ? 'is-off' : ''} onClick={toggleMute} aria-label={muted ? 'Unmute room microphone' : 'Mute room microphone'}>{muted ? <MicOff size={18} /> : <Mic size={18} />}</button>
      <button className="leave" onClick={leaveRoom} aria-label="Leave room"><PhoneOff size={18} /></button>
    </aside>
  )
}
