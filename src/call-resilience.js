// Extra WebRTC resilience without replacing Wavo's existing call stack.
// It appends optional TURN credentials, measures live connection health and
// softens video bandwidth when the network gets rough. The call UI listens
// for wavo:call-quality events to surface this without storing call media.

const OriginalPeerConnection = globalThis.RTCPeerConnection

function turnServers() {
  const urls = String(import.meta.env.VITE_TURN_URL || '').trim()
  if (!urls) return []
  const username = String(import.meta.env.VITE_TURN_USERNAME || '').trim()
  const credential = String(import.meta.env.VITE_TURN_CREDENTIAL || '').trim()
  return [{
    urls: urls.includes(',') ? urls.split(',').map((value) => value.trim()).filter(Boolean) : urls,
    ...(username ? { username } : {}),
    ...(credential ? { credential } : {}),
  }]
}

function emit(detail) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('wavo:call-quality', { detail }))
}

async function softenVideo(pc, maxBitrate = 220_000) {
  const senders = pc.getSenders?.() || []
  for (const sender of senders) {
    if (sender.track?.kind !== 'video' || !sender.getParameters || !sender.setParameters) continue
    try {
      const params = sender.getParameters()
      if (!params.encodings?.length) params.encodings = [{}]
      params.encodings = params.encodings.map((encoding) => ({ ...encoding, maxBitrate }))
      await sender.setParameters(params)
    } catch {}
  }
}

async function sampleQuality(pc) {
  if (!pc?.getStats) return null
  try {
    const report = await pc.getStats()
    let received = 0
    let lost = 0
    let jitter = 0
    let rtt = 0

    report.forEach((stat) => {
      if (stat.type === 'inbound-rtp' && !stat.isRemote) {
        received += Number(stat.packetsReceived || 0)
        lost += Number(stat.packetsLost || 0)
        jitter = Math.max(jitter, Number(stat.jitter || 0))
      }
      if (stat.type === 'candidate-pair' && (stat.nominated || stat.selected) && stat.state === 'succeeded') {
        rtt = Math.max(rtt, Number(stat.currentRoundTripTime || 0))
      }
      if (stat.type === 'remote-inbound-rtp') {
        rtt = Math.max(rtt, Number(stat.roundTripTime || 0))
      }
    })

    const total = received + Math.max(0, lost)
    const loss = total > 0 ? Math.max(0, lost) / total : 0
    let quality = 'good'
    if (loss >= 0.08 || rtt >= 0.65 || jitter >= 0.08) quality = 'poor'
    else if (loss >= 0.03 || rtt >= 0.32 || jitter >= 0.04) quality = 'fair'

    return { quality, loss, rtt, jitter }
  } catch {
    return null
  }
}

function instrument(pc) {
  if (!pc || pc.__wavoInstrumented) return pc
  pc.__wavoInstrumented = true
  let poorSamples = 0
  let closed = false

  const emitState = () => {
    const state = pc.connectionState || pc.iceConnectionState || 'new'
    emit({ active: state !== 'closed', state, quality: state === 'connected' ? undefined : 'unknown' })
    if (['failed', 'disconnected'].includes(state)) {
      // Reducing video bitrate is safe without renegotiation and gives audio
      // more room to recover while the existing ICE session reconnects.
      softenVideo(pc, 120_000)
    }
  }
  pc.addEventListener?.('connectionstatechange', emitState)
  pc.addEventListener?.('iceconnectionstatechange', emitState)

  const timer = globalThis.setInterval(async () => {
    if (closed || pc.connectionState === 'closed') return
    if (pc.connectionState !== 'connected') return
    const sample = await sampleQuality(pc)
    if (!sample) return
    poorSamples = sample.quality === 'poor' ? poorSamples + 1 : 0
    if (sample.quality === 'fair') await softenVideo(pc, 420_000)
    if (poorSamples >= 2) await softenVideo(pc, 180_000)
    emit({ active: true, state: 'connected', ...sample, suggestAudio: poorSamples >= 3 })
  }, 3000)

  const originalClose = pc.close?.bind(pc)
  if (originalClose) {
    pc.close = () => {
      closed = true
      globalThis.clearInterval(timer)
      emit({ active: false, state: 'closed' })
      return originalClose()
    }
  }
  return pc
}

if (OriginalPeerConnection && !OriginalPeerConnection.__wavoResiliencePatched) {
  function WavoPeerConnection(config = {}, constraints) {
    const extras = turnServers()
    const iceServers = [...(config?.iceServers || []), ...extras]
    const pc = new OriginalPeerConnection({ ...config, iceServers }, constraints)
    return instrument(pc)
  }
  WavoPeerConnection.prototype = OriginalPeerConnection.prototype
  Object.setPrototypeOf(WavoPeerConnection, OriginalPeerConnection)
  WavoPeerConnection.__wavoResiliencePatched = true
  WavoPeerConnection.__wavoOriginal = OriginalPeerConnection
  globalThis.RTCPeerConnection = WavoPeerConnection
}

export const turnConfigured = turnServers().length > 0
