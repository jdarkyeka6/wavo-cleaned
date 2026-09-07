import { supabase } from './supabaseClient'

const RING_WINDOW_MS = 45_000
const STARTUP_STABILIZE_MS = 350

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function ringingExpiryMs(call) {
  const createdAt = new Date(call?.created_at || 0).getTime()
  const expiresAt = new Date(call?.expires_at || 0).getTime()
  const createdExpiry = Number.isFinite(createdAt) && createdAt > 0
    ? createdAt + RING_WINDOW_MS
    : Number.POSITIVE_INFINITY
  const explicitExpiry = Number.isFinite(expiresAt) && expiresAt > 0
    ? expiresAt
    : Number.POSITIVE_INFINITY
  return Math.min(createdExpiry, explicitExpiry)
}

function isStillOpen(call) {
  if (call?.status === 'active') return true
  if (call?.status !== 'ringing') return false
  const expiry = ringingExpiryMs(call)
  return Number.isFinite(expiry) && expiry > Date.now()
}

async function fetchOpenCalls(userId, cutoff) {
  const { data, error } = await supabase
    .from('call_sessions')
    .select('*')
    .or(`caller_id.eq.${userId},callee_id.eq.${userId}`)
    .in('status', ['ringing', 'active'])
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(5)
  if (error) throw error
  return (data || []).filter(isStillOpen)
}

export async function createCall(callerId, calleeId, mode = 'video') {
  const { data, error } = await supabase
    .from('call_sessions')
    .insert({ caller_id: callerId, callee_id: calleeId, mode, status: 'ringing' })
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function updateCallStatus(callId, status) {
  const { data, error } = await supabase
    .from('call_sessions')
    .update({ status })
    .eq('id', callId)
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function getOpenCalls(userId) {
  // Startup is a race with the other device writing its final call status. A
  // first read can briefly see `ringing` after the caller has already hung up,
  // which used to flash a stale "is calling" overlay when Wavo opened. Respect
  // both expiry clocks and re-check ringing rows once after a tiny grace period
  // before letting the UI surface them.
  const cutoff = new Date(Date.now() - RING_WINDOW_MS).toISOString()
  const first = await fetchOpenCalls(userId, cutoff)
  if (!first.some((row) => row.status === 'ringing')) return first

  await sleep(STARTUP_STABILIZE_MS)
  return fetchOpenCalls(userId, cutoff)
}
