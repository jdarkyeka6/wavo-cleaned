// Lightweight media coordinator for the Waves feed.
// Keeps off-screen videos from competing for bandwidth and performs iOS
// unmute/play inside the user's actual tap gesture.

const PLAYER_SELECTOR = '.video-wave-player'
const FEED_SELECTOR = '.video-waves-feed'
const SOUND_SELECTOR = '.video-wave-sound'

let observer = null
let observedFeed = null
const observedVideos = new WeakSet()

function setPreload(video, value) {
  if (!video || video.preload === value) return
  video.preload = value
  video.setAttribute('preload', value)
}

function prepareVideo(video, visible) {
  if (!video) return
  if (visible) {
    setPreload(video, 'auto')
    // Do not restart media that is already loading/loaded. load() on a playing
    // element rewinds it, which is exactly what we do not want.
    if (video.readyState === 0 && (video.getAttribute('src') || video.querySelector('source'))) {
      try { video.load() } catch {}
    }
  } else {
    setPreload(video, 'none')
  }
}

function installObserver() {
  const feed = document.querySelector(FEED_SELECTOR)
  if (!feed) return

  if (feed !== observedFeed) {
    observer?.disconnect()
    observedFeed = feed
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        prepareVideo(entry.target, entry.isIntersecting && entry.intersectionRatio >= 0.18)
      }
    }, {
      root: feed,
      threshold: [0, 0.18, 0.55],
    })
  }

  feed.querySelectorAll(PLAYER_SELECTOR).forEach((video) => {
    if (observedVideos.has(video)) return
    observedVideos.add(video)
    // React currently gives every inactive Wave metadata preload. Clamp that to
    // none until the card is actually near the viewport.
    prepareVideo(video, false)
    observer.observe(video)
  })
}

// iOS/WebKit can reject audio if an autoplayed video is merely unmuted by a
// state update after the click has finished. Do the property change and play()
// synchronously inside the click gesture, then let React mirror the same state.
document.addEventListener('click', (event) => {
  const button = event.target?.closest?.(SOUND_SELECTOR)
  if (!button) return
  const card = button.closest('.video-wave-card')
  const video = card?.querySelector?.(PLAYER_SELECTOR)
  if (!video || !video.muted) return

  try {
    video.muted = false
    video.defaultMuted = false
    video.volume = 1
    const attempt = video.play()
    attempt?.catch?.(() => {})
  } catch {}
}, true)

const mutationObserver = new MutationObserver(() => installObserver())

function start() {
  installObserver()
  mutationObserver.observe(document.documentElement, { childList: true, subtree: true })
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
else start()
