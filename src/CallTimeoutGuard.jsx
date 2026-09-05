import { useEffect } from 'react'
import { supabase } from './supabaseClient'

const RING_TIMEOUT_MS = 45_000
const MAX_LOOKBACK_MS = 10 * 60_000

function createdAtMs(call) {
  const value = new Date(call?.created_at || 0).getTime()
  return Number.isFinite(value) ? value : 0
}

export default function CallTimeoutGuard() {
  useEffect(() => {
    let disposed = false
    let userId = null
    const timers = new Map()
    const channels = []

    function clearTimer(callId) {
      const timer = timers.get(callId)
      if (timer) window.clearTimeout(timer)
      timers.delete(callId)
    }

    async function expire(call) {
      if (!call?.id || call.status !== 'ringing' || disposed) return
      clearTimer(call.id)
      try {
        await supabase
          .from('call_sessions')
          .update({ status: 'missed' })
          .eq('id', call.id)
          .eq('status', 'ringing')
      } catch (err) {
        console.warn('[wavo calls] could not expire ringing call', err)
      }
    }

    function schedule(call) {
      if (!call?.id) return
      if (call.status !== 'ringing') {
        clearTimer(call.id)
        return
      }

      const age = Date.now() - createdAtMs(call)
      const remaining = RING_TIMEOUT_MS - age
      if (remaining <= 0) {
        expire(call)
        return
      }

      clearTimer(call.id)
      timers.set(call.id, window.setTimeout(() => expire(call), remaining + 120))
    }

    async function sweep() {
      if (!userId || disposed) return
      const cutoff = new Date(Date.now() - MAX_LOOKBACK_MS).toISOString()
      const { data, error } = await supabase
        .from('call_sessions')
        .select('id,caller_id,callee_id,status,created_at')
        .or(`caller_id.eq.${userId},callee_id.eq.${userId}`)
        .eq('status', 'ringing')
        .gte('created_at', cutoff)
        .order('created_at', { ascending: false })
        .limit(12)
      if (error || disposed) return
      for (const call of data || []) schedule(call)
    }

    function onRow(payload) {
      const row = payload.new || payload.old
      if (!row) return
      schedule(row)
    }

    async function setup() {
      const { data } = await supabase.auth.getUser()
      userId = data?.user?.id || null
      if (!userId || disposed) return

      const incoming = supabase
        .channel(`wavo-call-timeout-in:${userId}`)
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'call_sessions', filter: `callee_id=eq.${userId}`,
        }, onRow)
        .subscribe()

      const outgoing = supabase
        .channel(`wavo-call-timeout-out:${userId}`)
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'call_sessions', filter: `caller_id=eq.${userId}`,
        }, onRow)
        .subscribe()

      channels.push(incoming, outgoing)
      await sweep()
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') sweep().catch(() => {})
    }
    const onOnline = () => sweep().catch(() => {})

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    setup().catch((err) => console.warn('[wavo calls] timeout guard setup', err))

    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      timers.forEach((timer) => window.clearTimeout(timer))
      timers.clear()
      channels.forEach((channel) => supabase.removeChannel(channel))
    }
  }, [])

  return null
}
