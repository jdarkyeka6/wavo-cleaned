import { createElement as h, useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff, X } from 'lucide-react'
import { supabase } from './supabaseClient'
import { createCall, getOpenCalls, updateCallStatus } from './callData'
import './chat-motion-calls.css'

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

function cleanUsername(text) {
  return String(text || '').trim().replace(/^@/, '')
}

function displayName(profile) {
  return profile?.username ? `@${profile.username}` : 'Wavo friend'
}

function isTerminalStatus(status) {
  return ['declined', 'ended', 'missed', 'cancelled'].includes(status)
}

export default function ChatMotionCalls() {
  const [activeCall, setActiveCall] = useState(null)
  const [incomingCall, setIncomingCall] = useState(null)
  const [phase, setPhase] = useState('idle')
  const [error, setError] = useState('')
  const [muted, setMuted] = useState(false)
  const [cameraOff, setCameraOff] = useState(false)
  const [remoteReady, setRemoteReady] = useState(false)

  const activeCallRef = useRef(null)
  const incomingCallRef = useRef(null)
  const localVideoRef = useRef(null)
  const remoteVideoRef = useRef(null)
  const localStreamRef = useRef(null)
  const peerRef = useRef(null)
  const signalChannelRef = useRef(null)
  const pendingIceRef = useRef([])
  const offerSentRef = useRef(false)
  const startCallRef = useRef(null)

  useEffect(() => { activeCallRef.current = activeCall }, [activeCall])
  useEffect(() => { incomingCallRef.current = incomingCall }, [incomingCall])

  function resetPeerOnly() {
    if (signalChannelRef.current) {
      supabase.removeChannel(signalChannelRef.current)
      signalChannelRef.current = null
    }
    if (peerRef.current) {
      try { peerRef.current.close() } catch {}
      peerRef.current = null
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop())
      localStreamRef.current = null
    }
    pendingIceRef.current = []
    offerSentRef.current = false
    setRemoteReady(false)
    setMuted(false)
    setCameraOff(false)
  }

  async function finishCall({ notify = true, status = 'ended' } = {}) {
    const call = activeCallRef.current
    const channel = signalChannelRef.current
    if (notify && channel) {
      try {
        await channel.send({ type: 'broadcast', event: 'signal', payload: { type: 'hangup' } })
      } catch {}
    }
    resetPeerOnly()
    setActiveCall(null)
    setIncomingCall(null)
    setPhase('idle')
    setError('')
    if (notify && call?.id) {
      try { await updateCallStatus(call.id, status) } catch {}
    }
  }

  async function ensureRealtimeAuth() {
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (token && supabase.realtime?.setAuth) await supabase.realtime.setAuth(token)
  }

  async function openLocalMedia() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera and microphone are not available on this device.')
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    })
    localStreamRef.current = stream
    if (localVideoRef.current) localVideoRef.current.srcObject = stream
    return stream
  }

  function createPeerConnection(callId) {
    if (peerRef.current) return peerRef.current
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    peerRef.current = pc

    for (const track of localStreamRef.current?.getTracks?.() || []) {
      pc.addTrack(track, localStreamRef.current)
    }

    pc.ontrack = (event) => {
      const stream = event.streams?.[0]
      if (stream && remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream
        setRemoteReady(true)
        setPhase('active')
      }
    }

    pc.onicecandidate = async (event) => {
      if (!event.candidate || !signalChannelRef.current) return
      try {
        await signalChannelRef.current.send({
          type: 'broadcast',
          event: 'signal',
          payload: { type: 'candidate', candidate: event.candidate.toJSON() },
        })
      } catch (err) {
        console.warn('[wavo calls] ICE send failed', err)
      }
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') setPhase('active')
      if (['failed', 'disconnected'].includes(pc.connectionState)) setPhase('reconnecting')
      if (pc.connectionState === 'closed') setRemoteReady(false)
    }

    return pc
  }

  async function flushPendingIce(pc) {
    if (!pc.remoteDescription) return
    const queued = pendingIceRef.current.splice(0)
    for (const candidate of queued) {
      try { await pc.addIceCandidate(candidate) } catch (err) { console.warn('[wavo calls] queued ICE failed', err) }
    }
  }

  async function sendOffer(callId) {
    if (offerSentRef.current) return
    const pc = createPeerConnection(callId)
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true })
    await pc.setLocalDescription(offer)
    offerSentRef.current = true
    await signalChannelRef.current?.send({
      type: 'broadcast',
      event: 'signal',
      payload: { type: 'offer', sdp: pc.localDescription },
    })
  }

  async function handleSignal(payload, role, callId) {
    if (!payload?.type) return
    if (payload.type === 'hangup') {
      await finishCall({ notify: false })
      return
    }

    const pc = createPeerConnection(callId)

    if (payload.type === 'ready' && role === 'caller') {
      setPhase('connecting')
      await sendOffer(callId)
      return
    }

    if (payload.type === 'offer' && role === 'callee') {
      await pc.setRemoteDescription(payload.sdp)
      await flushPendingIce(pc)
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      await signalChannelRef.current?.send({
        type: 'broadcast',
        event: 'signal',
        payload: { type: 'answer', sdp: pc.localDescription },
      })
      setPhase('connecting')
      return
    }

    if (payload.type === 'answer' && role === 'caller') {
      await pc.setRemoteDescription(payload.sdp)
      await flushPendingIce(pc)
      setPhase('connecting')
      return
    }

    if (payload.type === 'candidate' && payload.candidate) {
      if (pc.remoteDescription) {
        try { await pc.addIceCandidate(payload.candidate) } catch (err) { console.warn('[wavo calls] ICE add failed', err) }
      } else {
        pendingIceRef.current.push(payload.candidate)
      }
    }
  }

  async function joinSignalChannel(callId, role) {
    await ensureRealtimeAuth()
    if (signalChannelRef.current) await supabase.removeChannel(signalChannelRef.current)

    const channel = supabase.channel(`wavo-call:${callId}`, {
      config: { private: true, broadcast: { self: false } },
    })
    signalChannelRef.current = channel

    channel.on('broadcast', { event: 'signal' }, async ({ payload }) => {
      try { await handleSignal(payload, role, callId) } catch (err) {
        console.error('[wavo calls] signal error', err)
        setError('The call connection hit a problem.')
      }
    })

    await new Promise((resolve, reject) => {
      let settled = false
      const timer = window.setTimeout(() => {
        if (!settled) {
          settled = true
          reject(new Error('Call signalling timed out.'))
        }
      }, 8000)

      channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED' && !settled) {
          settled = true
          window.clearTimeout(timer)
          resolve()
        }
        if (['CHANNEL_ERROR', 'TIMED_OUT'].includes(status) && !settled) {
          settled = true
          window.clearTimeout(timer)
          reject(new Error('Call signalling could not connect.'))
        }
      })
    })

    return channel
  }

  async function profileForUsername(username) {
    const { data, error: lookupError } = await supabase
      .from('profiles')
      .select('id, username, avatar_url, status')
      .ilike('username', username)
      .limit(1)
      .maybeSingle()
    if (lookupError) throw lookupError
    if (!data) throw new Error('Could not find this Wavo friend.')
    return data
  }

  function usernameFromChatHeader() {
    const topbar = document.querySelector('.chat-topbar')
    const textBlocks = topbar ? Array.from(topbar.children).filter((node) => node.tagName === 'DIV' && !node.classList.contains('avatar')) : []
    const info = textBlocks[textBlocks.length - 1]
    const secondary = cleanUsername(info?.querySelector('span')?.textContent)
    const primary = cleanUsername(info?.querySelector('strong')?.textContent)
    return secondary || primary
  }

  async function startOutgoingCall() {
    if (activeCallRef.current || incomingCallRef.current) return
    setError('')
    setPhase('preparing')
    try {
      const username = usernameFromChatHeader()
      if (!username) throw new Error('Could not identify this chat.')
      const peer = await profileForUsername(username)
      const { data: authData } = await supabase.auth.getUser()
      const me = authData?.user
      if (!me) throw new Error('You are not signed in.')

      const call = await createCall(me.id, peer.id, 'video')
      const next = { ...call, peer, role: 'caller' }
      setActiveCall(next)
      activeCallRef.current = next
      setPhase('calling')

      await openLocalMedia()
      await joinSignalChannel(call.id, 'caller')
    } catch (err) {
      console.error('[wavo calls] start failed', err)
      resetPeerOnly()
      setActiveCall(null)
      setPhase('idle')
      const msg = String(err?.message || '')
      if (msg.includes('call_sessions') || msg.includes('relation')) {
        setError('Video call signalling is not enabled on the server yet.')
      } else if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('denied')) {
        setError('Camera or microphone permission was denied.')
      } else {
        setError(msg || 'Could not start the video call.')
      }
    }
  }

  startCallRef.current = startOutgoingCall

  async function acceptIncoming() {
    const pending = incomingCallRef.current
    if (!pending) return
    setError('')
    const next = { ...pending, role: 'callee' }
    setIncomingCall(null)
    setActiveCall(next)
    activeCallRef.current = next
    setPhase('preparing')
    try {
      await updateCallStatus(pending.id, 'active')
      await openLocalMedia()
      const channel = await joinSignalChannel(pending.id, 'callee')
      createPeerConnection(pending.id)
      await channel.send({ type: 'broadcast', event: 'signal', payload: { type: 'ready' } })
      setPhase('connecting')
    } catch (err) {
      console.error('[wavo calls] accept failed', err)
      setError(err?.message || 'Could not join the call.')
      await finishCall({ notify: true, status: 'ended' })
    }
  }

  async function declineIncoming() {
    const pending = incomingCallRef.current
    setIncomingCall(null)
    if (pending?.id) {
      try { await updateCallStatus(pending.id, 'declined') } catch {}
    }
  }

  function toggleMute() {
    const audioTracks = localStreamRef.current?.getAudioTracks?.() || []
    const next = !muted
    audioTracks.forEach((track) => { track.enabled = !next })
    setMuted(next)
  }

  function toggleCamera() {
    const videoTracks = localStreamRef.current?.getVideoTracks?.() || []
    const next = !cameraOff
    videoTracks.forEach((track) => { track.enabled = !next })
    setCameraOff(next)
  }

  useEffect(() => {
    let chat = null
    let button = null
    let swipeCleanup = null

    function installSwipe(screen) {
      if (!screen || screen.dataset.wavoSwipeBack === '1') return () => {}
      screen.dataset.wavoSwipeBack = '1'
      let pointerId = null
      let startX = 0
      let startY = 0
      let startAt = 0
      let dragging = false
      let lastDx = 0

      function resetClasses() {
        screen.classList.remove('wavo-chat-swiping', 'wavo-chat-swipe-reset', 'wavo-chat-swipe-leaving')
        screen.style.removeProperty('--wavo-chat-drag')
        screen.style.removeProperty('--wavo-chat-progress')
      }

      function onDown(event) {
        if (event.pointerType === 'mouse' || event.clientX > 34 || activeCallRef.current) return
        pointerId = event.pointerId
        startX = event.clientX
        startY = event.clientY
        startAt = performance.now()
        dragging = false
        lastDx = 0
        try { screen.setPointerCapture(pointerId) } catch {}
      }

      function onMove(event) {
        if (pointerId !== event.pointerId) return
        const dx = Math.max(0, event.clientX - startX)
        const dy = Math.abs(event.clientY - startY)
        if (!dragging) {
          if (dx < 6) return
          if (dy > dx * 0.9) {
            pointerId = null
            return
          }
          dragging = true
          screen.classList.add('wavo-chat-swiping')
        }
        lastDx = Math.min(window.innerWidth, dx)
        const progress = Math.min(1, lastDx / Math.max(1, window.innerWidth))
        screen.style.setProperty('--wavo-chat-drag', `${lastDx}px`)
        screen.style.setProperty('--wavo-chat-progress', String(progress))
        event.preventDefault()
      }

      function onUp(event) {
        if (pointerId !== event.pointerId) return
        const elapsed = Math.max(1, performance.now() - startAt)
        const velocity = lastDx / elapsed
        pointerId = null
        if (!dragging) return
        dragging = false

        const complete = lastDx > Math.min(120, window.innerWidth * 0.28) || velocity > 0.55
        if (complete) {
          screen.classList.remove('wavo-chat-swiping')
          screen.classList.add('wavo-chat-swipe-leaving')
          screen.style.setProperty('--wavo-chat-drag', `${window.innerWidth}px`)
          window.setTimeout(() => {
            const back = screen.querySelector('.chat-topbar > button:first-child')
            back?.click()
            resetClasses()
          }, 185)
        } else {
          screen.classList.remove('wavo-chat-swiping')
          screen.classList.add('wavo-chat-swipe-reset')
          screen.style.setProperty('--wavo-chat-drag', '0px')
          screen.style.setProperty('--wavo-chat-progress', '0')
          window.setTimeout(resetClasses, 210)
        }
      }

      function onCancel() {
        pointerId = null
        dragging = false
        screen.classList.add('wavo-chat-swipe-reset')
        screen.style.setProperty('--wavo-chat-drag', '0px')
        window.setTimeout(resetClasses, 210)
      }

      screen.addEventListener('pointerdown', onDown)
      screen.addEventListener('pointermove', onMove, { passive: false })
      screen.addEventListener('pointerup', onUp)
      screen.addEventListener('pointercancel', onCancel)

      return () => {
        delete screen.dataset.wavoSwipeBack
        screen.removeEventListener('pointerdown', onDown)
        screen.removeEventListener('pointermove', onMove)
        screen.removeEventListener('pointerup', onUp)
        screen.removeEventListener('pointercancel', onCancel)
        resetClasses()
      }
    }

    function syncChatChrome() {
      const nextChat = document.querySelector('.chat-screen')
      if (nextChat !== chat) {
        swipeCleanup?.()
        chat = nextChat
        swipeCleanup = installSwipe(chat)
      }

      const topbar = document.querySelector('.chat-topbar')
      if (!topbar) {
        if (button) button.remove()
        button = null
        return
      }

      if (!topbar.querySelector('.wavo-video-call-button')) {
        button = document.createElement('button')
        button.type = 'button'
        button.className = 'wavo-video-call-button'
        button.setAttribute('aria-label', 'Start video call')
        button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 10l4.55-2.6A1 1 0 0 1 21 8.27v7.46a1 1 0 0 1-1.45.87L15 14v1.5A2.5 2.5 0 0 1 12.5 18h-7A2.5 2.5 0 0 1 3 15.5v-7A2.5 2.5 0 0 1 5.5 6h7A2.5 2.5 0 0 1 15 8.5V10Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        button.addEventListener('click', () => startCallRef.current?.())
        topbar.classList.add('wavo-call-ready')
        topbar.appendChild(button)
      } else {
        button = topbar.querySelector('.wavo-video-call-button')
      }
    }

    syncChatChrome()
    const observer = new MutationObserver(syncChatChrome)
    observer.observe(document.body, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      swipeCleanup?.()
      if (button) button.remove()
      document.querySelector('.chat-topbar')?.classList.remove('wavo-call-ready')
    }
  }, [])

  useEffect(() => {
    let mounted = true
    let incomingChannel = null
    let outgoingChannel = null

    async function setup() {
      const { data } = await supabase.auth.getUser()
      const user = data?.user
      if (!user || !mounted) return

      incomingChannel = supabase
        .channel(`wavo-call-incoming:${user.id}`)
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'call_sessions', filter: `callee_id=eq.${user.id}`,
        }, async (payload) => {
          const row = payload.new || payload.old
          if (!row) return
          if (activeCallRef.current?.id === row.id && isTerminalStatus(row.status)) {
            await finishCall({ notify: false })
            return
          }
          if (row.status !== 'ringing' || activeCallRef.current || incomingCallRef.current) return
          try {
            const { data: peer } = await supabase.from('profiles').select('id, username, avatar_url, status').eq('id', row.caller_id).maybeSingle()
            const next = { ...row, peer: peer || { id: row.caller_id, username: 'Wavo friend' } }
            incomingCallRef.current = next
            setIncomingCall(next)
          } catch (err) {
            console.warn('[wavo calls] incoming profile failed', err)
          }
        })
        .subscribe()

      outgoingChannel = supabase
        .channel(`wavo-call-outgoing:${user.id}`)
        .on('postgres_changes', {
          event: 'UPDATE', schema: 'public', table: 'call_sessions', filter: `caller_id=eq.${user.id}`,
        }, async (payload) => {
          const row = payload.new
          if (!row || activeCallRef.current?.id !== row.id) return
          if (row.status === 'active') setPhase((current) => current === 'calling' ? 'connecting' : current)
          if (isTerminalStatus(row.status)) await finishCall({ notify: false })
        })
        .subscribe()

      try {
        const open = await getOpenCalls(user.id)
        const ringing = open.find((row) => row.callee_id === user.id && row.status === 'ringing')
        if (ringing && !activeCallRef.current && !incomingCallRef.current) {
          const { data: peer } = await supabase.from('profiles').select('id, username, avatar_url, status').eq('id', ringing.caller_id).maybeSingle()
          const next = { ...ringing, peer: peer || { id: ringing.caller_id, username: 'Wavo friend' } }
          incomingCallRef.current = next
          setIncomingCall(next)
        }
      } catch (err) {
        console.info('[wavo calls] call table not ready yet', err?.message || err)
      }
    }

    setup()
    return () => {
      mounted = false
      if (incomingChannel) supabase.removeChannel(incomingChannel)
      if (outgoingChannel) supabase.removeChannel(outgoingChannel)
      resetPeerOnly()
    }
  }, [])

  useEffect(() => {
    if (localVideoRef.current && localStreamRef.current) localVideoRef.current.srcObject = localStreamRef.current
  }, [activeCall, phase])

  const incomingOverlay = incomingCall && !activeCall
    ? h('div', { className: 'wavo-incoming-call', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Incoming video call' },
        h('div', { className: 'wavo-incoming-call-card' },
          h('button', { className: 'wavo-call-close', onClick: declineIncoming, 'aria-label': 'Dismiss call' }, h(X, { size: 20 })),
          h('div', { className: 'wavo-call-avatar' }, incomingCall.peer?.avatar_url
            ? h('img', { src: incomingCall.peer.avatar_url, alt: '' })
            : String(incomingCall.peer?.username || 'W').slice(0, 1).toUpperCase()),
          h('span', { className: 'wavo-call-kicker' }, 'INCOMING VIDEO CALL'),
          h('h2', null, displayName(incomingCall.peer)),
          h('p', null, 'Wants to video call you.'),
          h('div', { className: 'wavo-incoming-actions' },
            h('button', { className: 'wavo-call-decline', onClick: declineIncoming }, h(PhoneOff, { size: 21 }), h('span', null, 'Decline')),
            h('button', { className: 'wavo-call-accept', onClick: acceptIncoming }, h(Phone, { size: 21 }), h('span', null, 'Accept')),
          ),
        ),
      )
    : null

  const activeOverlay = activeCall
    ? h('div', { className: 'wavo-video-call', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Video call' },
        h('video', { ref: remoteVideoRef, className: `wavo-remote-video${remoteReady ? ' ready' : ''}`, autoPlay: true, playsInline: true }),
        h('div', { className: 'wavo-call-backdrop' }),
        h('div', { className: 'wavo-call-head' },
          h('div', null,
            h('span', { className: 'wavo-call-kicker' }, phase === 'active' ? 'VIDEO CALL' : 'CONNECTING'),
            h('strong', null, displayName(activeCall.peer)),
            h('small', null, phase === 'calling' ? 'Ringing…' : phase === 'preparing' ? 'Starting camera…' : phase === 'reconnecting' ? 'Reconnecting…' : phase === 'active' ? 'Connected' : 'Connecting…'),
          ),
          h('button', { className: 'wavo-call-close', onClick: () => finishCall(), 'aria-label': 'End video call' }, h(X, { size: 20 })),
        ),
        h('div', { className: 'wavo-local-preview' },
          h('video', { ref: localVideoRef, autoPlay: true, muted: true, playsInline: true }),
          cameraOff ? h('div', { className: 'wavo-camera-off-label' }, h(VideoOff, { size: 18 }), 'Camera off') : null,
        ),
        !remoteReady ? h('div', { className: 'wavo-call-waiting' },
          h('div', { className: 'wavo-call-avatar compact' }, activeCall.peer?.avatar_url
            ? h('img', { src: activeCall.peer.avatar_url, alt: '' })
            : String(activeCall.peer?.username || 'W').slice(0, 1).toUpperCase()),
          h('strong', null, displayName(activeCall.peer)),
          h('span', null, phase === 'calling' ? 'Ringing…' : 'Making the connection…'),
        ) : null,
        h('div', { className: 'wavo-call-controls' },
          h('button', { className: muted ? 'is-off' : '', onClick: toggleMute, 'aria-label': muted ? 'Unmute microphone' : 'Mute microphone' }, muted ? h(MicOff, { size: 22 }) : h(Mic, { size: 22 })),
          h('button', { className: cameraOff ? 'is-off' : '', onClick: toggleCamera, 'aria-label': cameraOff ? 'Turn camera on' : 'Turn camera off' }, cameraOff ? h(VideoOff, { size: 22 }) : h(Video, { size: 22 })),
          h('button', { className: 'hangup', onClick: () => finishCall(), 'aria-label': 'End call' }, h(PhoneOff, { size: 23 })),
        ),
      )
    : null

  const errorToast = error
    ? h('button', { className: 'wavo-call-error', onClick: () => setError('') }, error)
    : null

  return h('div', { className: 'wavo-chat-motion-root' }, incomingOverlay, activeOverlay, errorToast)
}
