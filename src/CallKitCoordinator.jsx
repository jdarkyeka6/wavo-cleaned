import { useEffect } from 'react'
import { supabase } from './supabaseClient'
import {
  addCallKitActionListener,
  callKitSupported,
  consumePendingCallKitAction,
  endNativeCall,
} from './callKitBridge'

const TERMINAL = new Set(['declined', 'ended', 'missed', 'cancelled'])

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function clickIncomingAccept(callId) {
  // ChatMotionCalls owns WebRTC setup. Let it discover the ringing DB row, then
  // press the same Accept path the in-app UI uses so there is still exactly one
  // media/signalling implementation.
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const button = document.querySelector('.wavo-incoming-call .wavo-call-accept')
    if (button) {
      button.click()
      return true
    }

    // If another call already became active, don't click a stale overlay.
    const active = document.querySelector('.wavo-video-call')
    if (active) return true

    await wait(100)
  }

  console.warn('[wavo callkit] could not hand answered call to WebRTC', callId)
  return false
}

async function callIsStillAnswerable(callId) {
  try {
    const { data, error } = await supabase
      .from('call_sessions')
      .select('id,status,created_at,expires_at')
      .eq('id', callId)
      .maybeSingle()

    if (error || !data || data.status !== 'ringing') return false

    const createdAt = new Date(data.created_at || 0).getTime()
    const expiresAt = new Date(data.expires_at || 0).getTime()
    const hardExpiry = Math.min(
      Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : Number.POSITIVE_INFINITY,
      Number.isFinite(createdAt) && createdAt > 0 ? createdAt + 45_000 : Number.POSITIVE_INFINITY,
    )

    return Number.isFinite(hardExpiry) && hardExpiry > Date.now()
  } catch (err) {
    console.warn('[wavo callkit] could not validate answered call', err)
    return false
  }
}

async function setTerminalStatus(callId, status) {
  if (!callId) return
  try {
    // Only transition an open call. This prevents a late CallKit callback from
    // overwriting a newer terminal state written by the other phone.
    const { error } = await supabase
      .from('call_sessions')
      .update({ status })
      .eq('id', callId)
      .in('status', ['ringing', 'active'])
    if (error) throw error
  } catch (err) {
    console.warn('[wavo callkit] status update failed', err)
  }
}

export default function CallKitCoordinator() {
  useEffect(() => {
    if (!callKitSupported()) return undefined

    let cancelled = false
    let callActionHandle = null
    let callUpdates = null
    const seen = new Set()

    async function handleAction(action) {
      if (!action || cancelled) return
      const callId = String(action.callId || '')
      const kind = String(action.action || '')
      if (!callId || !kind) return

      const key = `${kind}:${callId}`
      if (seen.has(key)) return
      seen.add(key)

      if (kind === 'answer') {
        // CallKit actions can survive app suspension. Never let a delayed answer
        // resurrect a call that has already timed out or ended in Postgres.
        if (!(await callIsStillAnswerable(callId))) {
          await endNativeCall(callId)
          return
        }

        // Calls can arrive while the user was last on Waves/Admin, where the
        // WebRTC component is intentionally not mounted. Move into Wavo first;
        // the native pending action survives the reload and is consumed there.
        if (window.location.pathname === '/waves' || window.location.pathname === '/admin') {
          window.location.assign('/chats')
          return
        }

        const accepted = await clickIncomingAccept(callId)
        if (!accepted) {
          // Do not leave iOS showing a connected system call if the web layer
          // failed to start media/signalling.
          await setTerminalStatus(callId, 'ended')
          await endNativeCall(callId)
        }
        return
      }

      if (kind === 'decline') {
        await setTerminalStatus(callId, 'declined')
        return
      }

      if (kind === 'end') {
        await setTerminalStatus(callId, 'ended')
      }
    }

    async function consumePending() {
      try {
        const pending = await consumePendingCallKitAction()
        if (pending) await handleAction(pending)
      } catch (err) {
        console.warn('[wavo callkit] pending action failed', err)
      }
    }

    async function setup() {
      callActionHandle = await addCallKitActionListener(async (action) => {
        await handleAction(action)
        // The native side persists actions so a killed/suspended web view cannot
        // lose them. Consume after the live callback so it does not replay later.
        await consumePendingCallKitAction()
      })

      await consumePending()

      const { data } = await supabase.auth.getUser()
      const user = data?.user
      if (!user || cancelled) return

      callUpdates = supabase
        .channel(`wavo-callkit-status:${user.id}`)
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'call_sessions',
          filter: `callee_id=eq.${user.id}`,
        }, async ({ new: row }) => {
          if (row?.id && TERMINAL.has(row.status)) {
            await endNativeCall(row.id)
          }
        })
        .subscribe()
    }

    function onVisible() {
      if (document.visibilityState === 'visible') consumePending()
    }

    document.addEventListener('visibilitychange', onVisible)
    setup()

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      callActionHandle?.remove?.()
      if (callUpdates) supabase.removeChannel(callUpdates)
    }
  }, [])

  return null
}
