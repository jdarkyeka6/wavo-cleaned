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
