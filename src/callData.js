import { supabase } from './supabaseClient'

const RING_WINDOW_MS = 45_000

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
  // Only surface genuinely current calls. A device opening Wavo later must not
  // resurrect an old ringing row and make a timed-out call appear again.
  const cutoff = new Date(Date.now() - RING_WINDOW_MS).toISOString()
  const { data, error } = await supabase
    .from('call_sessions')
    .select('*')
    .or(`caller_id.eq.${userId},callee_id.eq.${userId}`)
    .in('status', ['ringing', 'active'])
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(5)
  if (error) throw error
  return data || []
}
