import { useEffect, useRef } from 'react'

// Collect small per-video totals, not a timeline of individual playback events.
export function useWavesWatchSignals(videoRef, post, active, onSignal) {
  const onSignalRef = useRef(onSignal)
  onSignalRef.current = onSignal
  const stateRef = useRef({
    delta: { watchedMs: 0, plays: 0, completions: 0, skips: 0, rewatches: 0 },
    sessionMs: 0, lapMs: 0, completed: false, completedLap: false,
    played: false, previousTime: null,
  })

  function flush(leaving = false) {
    const state = stateRef.current
    const durationMs = Number(videoRef.current?.duration) * 1000
    if (leaving && state.played && !state.completed && Number.isFinite(durationMs)
      && durationMs >= 3000 && state.sessionMs >= 500 && state.sessionMs < durationMs * 0.35) {
      state.delta.skips += 1
    }
    const delta = state.delta
    if (delta.watchedMs || delta.plays || delta.completions || delta.skips || delta.rewatches) {
      onSignalRef.current?.(post, { ...delta })
    }
    state.delta = { watchedMs: 0, plays: 0, completions: 0, skips: 0, rewatches: 0 }
    if (leaving) {
      state.sessionMs = 0
      state.lapMs = 0
      state.completed = false
      state.completedLap = false
      state.played = false
      state.previousTime = null
    }
  }

  useEffect(() => {
    if (!active) flush(true)
    const onHidden = () => { if (document.hidden) flush(true) }
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      flush(true)
    }
  }, [active, post.id])

  function onPlay() {
    if (!active || document.hidden || stateRef.current.played) return
    const state = stateRef.current
    state.played = true
    state.previousTime = videoRef.current?.currentTime ?? null
    state.delta.plays += 1
  }

  function onTimeUpdate() {
    const video = videoRef.current
    const state = stateRef.current
    if (!active || document.hidden || !video || video.paused || !state.played) return
    const current = video.currentTime
    const previous = state.previousTime
    const durationMs = video.duration * 1000
    if (previous != null && current < previous - 0.8) {
      if (Number.isFinite(durationMs) && previous * 1000 >= durationMs * 0.85 && state.completedLap) {
        state.delta.rewatches += 1
      }
      state.lapMs = 0
      state.completedLap = false
    } else if (previous != null && current > previous) {
      // Seeking does not count as watching everything between the two positions.
      const elapsed = current - previous
      if (elapsed < 2.5) {
        const watched = Math.round(elapsed * 1000)
        state.sessionMs += watched
        state.lapMs += watched
        state.delta.watchedMs += watched
      }
    }
    state.previousTime = current
    if (Number.isFinite(durationMs) && durationMs > 0 && !state.completedLap
      && current * 1000 >= durationMs * 0.9 && state.lapMs >= durationMs * 0.6) {
      state.delta.completions += 1
      state.completed = true
      state.completedLap = true
    }
    if (state.delta.watchedMs >= 10000) flush()
  }

  return { onPlay, onTimeUpdate }
}
