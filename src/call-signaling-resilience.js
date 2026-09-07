// Supabase Realtime broadcasts are intentionally ephemeral. During an incoming
// call the callee can answer before the caller has finished opening media and
// joining the private signalling channel, which means the original one-shot
// `ready` packet can be lost. Retry only that idempotent packet for a few
// seconds. ChatMotionCalls already ignores duplicate readiness after its offer
// has been sent, so this closes the race without creating a second call stack.

import { supabase } from './supabaseClient'

const originalChannel = supabase.channel.bind(supabase)
const RETRY_DELAYS_MS = [300, 700, 1300, 2200, 3500]

supabase.channel = function wavoResilientChannel(name, config) {
  const channel = originalChannel(name, config)
  if (!String(name || '').startsWith('wavo-call:') || channel.__wavoReadyRetry) {
    return channel
  }

  channel.__wavoReadyRetry = true
  const originalSend = channel.send.bind(channel)

  channel.send = async function resilientSend(message) {
    const result = await originalSend(message)
    const isReady = message?.type === 'broadcast'
      && message?.event === 'signal'
      && message?.payload?.type === 'ready'

    if (isReady) {
      for (const delay of RETRY_DELAYS_MS) {
        window.setTimeout(() => {
          // Once the channel is gone/closed Supabase will simply reject the
          // packet; duplicates are harmless because sendOffer is idempotent.
          originalSend(message).catch?.(() => {})
        }, delay)
      }
    }

    return result
  }

  return channel
}

// ChatMotionCalls can occasionally surface its generic signalling error during
// a harmless WebRTC race even though the peer connection immediately recovers.
// Keep that transient warning out of the UI while the call gets a short chance
// to settle. If the call reaches Connected, dismiss it completely. If it does
// not recover, reveal the warning after a couple of seconds so real failures
// are still visible to the user.
const TRANSIENT_SIGNAL_ERROR = 'The call connection hit a problem.'
const SIGNAL_ERROR_GRACE_MS = 2500

function callStatusText(root) {
  const call = root?.querySelector('.wavo-video-call')
  if (!call) return ''
  const smalls = Array.from(call.querySelectorAll('small'))
  return smalls.map((node) => String(node.textContent || '').trim()).find(Boolean) || ''
}

function guardTransientSignalError() {
  const root = document.querySelector('.wavo-chat-motion-root')
  const button = root?.querySelector('.wavo-call-error')
  if (!button || String(button.textContent || '').trim() !== TRANSIENT_SIGNAL_ERROR) return
  if (button.dataset.wavoSignalGuard === '1') return

  button.dataset.wavoSignalGuard = '1'
  button.hidden = true
  const startedAt = Date.now()

  const timer = window.setInterval(() => {
    if (!button.isConnected) {
      window.clearInterval(timer)
      return
    }

    const status = callStatusText(root)
    if (status === 'Connected') {
      window.clearInterval(timer)
      button.click()
      return
    }

    if (Date.now() - startedAt >= SIGNAL_ERROR_GRACE_MS) {
      window.clearInterval(timer)
      button.hidden = false
    }
  }, 100)
}

function installSignalErrorGuard() {
  guardTransientSignalError()
  const observer = new MutationObserver(guardTransientSignalError)
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installSignalErrorGuard, { once: true })
} else {
  installSignalErrorGuard()
}
