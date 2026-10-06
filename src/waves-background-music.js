// Original, code-generated background music for Waves.
// No external song or copyrighted recording is bundled. The soundtrack starts
// after the first user gesture (required by iOS/WebKit), stays quiet under the
// feed, and ducks whenever a Wave's own audio is playing.

const STORAGE_KEY = 'wavo:waves:bg-music'
const BUTTON_CLASS = 'video-waves-music-toggle'
const PLAYER_SELECTOR = '.video-wave-player'

let context = null
let master = null
let filter = null
let timer = null
let nextLoopAt = 0
let enabled = readEnabled()
let lastShellPresent = false
const wiredVideos = new WeakSet()

function readEnabled() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored == null ? true : stored === '1'
  } catch {
    return true
  }
}

function saveEnabled() {
  try { localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0') } catch {}
}

function ensureAudio() {
  if (context) return context
  const AudioContext = window.AudioContext || window.webkitAudioContext
  if (!AudioContext) return null

  context = new AudioContext()
  master = context.createGain()
  master.gain.value = 0

  filter = context.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 1450
  filter.Q.value = 0.55

  const compressor = context.createDynamicsCompressor()
  compressor.threshold.value = -24
  compressor.knee.value = 16
  compressor.ratio.value = 3
  compressor.attack.value = 0.02
  compressor.release.value = 0.35

  filter.connect(compressor)
  compressor.connect(master)
  master.connect(context.destination)
  return context
}

function waveAudioIsPlaying() {
  const shell = document.querySelector('.video-waves-shell')
  if (!shell) return false
  return [...shell.querySelectorAll(PLAYER_SELECTOR)].some((video) =>
    !video.muted && !video.paused && !video.ended && video.readyState >= 2
  )
}

function targetVolume() {
  if (!enabled || document.hidden || !document.querySelector('.video-waves-shell')) return 0
  if (waveAudioIsPlaying()) return 0
  return 0.055
}

function updateGain(fast = false) {
  if (!context || !master) return
  const now = context.currentTime
  const target = targetVolume()
  master.gain.cancelScheduledValues(now)
  master.gain.setTargetAtTime(target, now, fast ? 0.025 : 0.18)
  if (target > 0 && context.state === 'suspended') context.resume().catch(() => {})
}

const CHORDS = [
  [220.00, 261.63, 329.63, 392.00], // Am7-ish colour
  [174.61, 220.00, 261.63, 329.63], // Fmaj7
  [196.00, 246.94, 293.66, 392.00], // G6
  [164.81, 220.00, 261.63, 329.63], // C/E ambience
]

function tone(freq, start, duration, gain, type = 'sine', detune = 0) {
  if (!context || !filter) return
  const osc = context.createOscillator()
  const amp = context.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  osc.detune.setValueAtTime(detune, start)

  amp.gain.setValueAtTime(0.0001, start)
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), start + 0.18)
  amp.gain.exponentialRampToValueAtTime(Math.max(0.00015, gain * 0.45), start + duration * 0.72)
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration)

  osc.connect(amp)
  amp.connect(filter)
  osc.start(start)
  osc.stop(start + duration + 0.05)
}

function scheduleLoop(start) {
  // 16-second, four-chord ambient loop. Pads are deliberately sparse and
  // quiet so Waves still feels like a video app, not a music player.
  CHORDS.forEach((chord, chordIndex) => {
    const chordStart = start + chordIndex * 4
    chord.forEach((freq, noteIndex) => {
      tone(freq / 2, chordStart, 3.85, noteIndex === 0 ? 0.020 : 0.012, 'sine', noteIndex % 2 ? 3 : -3)
    })

    // A tiny glassy pulse gives the loop motion without stealing attention.
    const arp = [chord[0], chord[2], chord[1], chord[3], chord[2], chord[1], chord[0], chord[2]]
    arp.forEach((freq, i) => {
      tone(freq * 2, chordStart + i * 0.5, 0.42, 0.0055, 'triangle', i % 2 ? 4 : -4)
    })
  })
}

function keepScheduled() {
  if (!context) return
  const horizon = context.currentTime + 7
  while (nextLoopAt < horizon) {
    scheduleLoop(nextLoopAt)
    nextLoopAt += 16
  }
}

async function unlockAndStart() {
  if (!enabled || !document.querySelector('.video-waves-shell')) return
  const ctx = ensureAudio()
  if (!ctx) return
  try { await ctx.resume() } catch {}
  if (!nextLoopAt || nextLoopAt < ctx.currentTime - 1) nextLoopAt = ctx.currentTime + 0.05
  keepScheduled()
  if (!timer) timer = window.setInterval(keepScheduled, 3000)
  updateGain(true)
}

function styleButton(button) {
  button.style.display = 'inline-flex'
  button.style.alignItems = 'center'
  button.style.justifyContent = 'center'
  button.style.gap = '5px'
  button.style.minWidth = '38px'
  button.style.height = '34px'
  button.style.padding = '0 10px'
  button.style.borderRadius = '999px'
  button.style.border = '1px solid rgba(103, 216, 255, .2)'
  button.style.background = 'rgba(7, 23, 37, .68)'
  button.style.color = 'inherit'
  button.style.backdropFilter = 'blur(14px)'
  button.style.webkitBackdropFilter = 'blur(14px)'
  button.style.cursor = 'pointer'
  button.style.font = 'inherit'
  button.style.fontSize = '12px'
  button.style.fontWeight = '700'
}

function refreshButton(button) {
  if (!button) return
  button.textContent = enabled ? '♫ On' : '♫ Off'
  button.setAttribute('aria-label', enabled ? 'Turn Waves background music off' : 'Turn Waves background music on')
  button.title = enabled ? 'Background music on' : 'Background music off'
  button.setAttribute('aria-pressed', enabled ? 'true' : 'false')
  button.style.opacity = enabled ? '1' : '.65'
}

function installButton() {
  const actions = document.querySelector('.video-waves-top-actions')
  if (!actions) return
  let button = actions.querySelector('.' + BUTTON_CLASS)
  if (button) {
    refreshButton(button)
    return
  }

  button = document.createElement('button')
  button.type = 'button'
  button.className = BUTTON_CLASS
  styleButton(button)
  refreshButton(button)
  button.addEventListener('click', async (event) => {
    event.preventDefault()
    event.stopPropagation()
    enabled = !enabled
    saveEnabled()
    refreshButton(button)
    if (enabled) await unlockAndStart()
    updateGain(true)
  })
  actions.prepend(button)
}

function wireVideo(video) {
  if (wiredVideos.has(video)) return
  wiredVideos.add(video)
  const update = () => updateGain()
  video.addEventListener('volumechange', update)
  video.addEventListener('play', update)
  video.addEventListener('pause', update)
  video.addEventListener('ended', update)
}

function scan() {
  const shell = document.querySelector('.video-waves-shell')
  const shellPresent = Boolean(shell)
  if (shellPresent) {
    installButton()
    shell.querySelectorAll(PLAYER_SELECTOR).forEach(wireVideo)
  }
  if (lastShellPresent !== shellPresent) {
    lastShellPresent = shellPresent
    updateGain(true)
  }
}

// iOS requires the audio graph to be resumed by a user gesture. One gesture
// anywhere inside Waves is enough; the user's music preference still controls
// whether any sound starts.
document.addEventListener('pointerdown', (event) => {
  if (!enabled || !event.target?.closest?.('.video-waves-shell')) return
  void unlockAndStart()
}, { capture: true, passive: true })

document.addEventListener('visibilitychange', () => updateGain(true))

const observer = new MutationObserver(scan)
function start() {
  scan()
  observer.observe(document.documentElement, { childList: true, subtree: true })
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
else start()
