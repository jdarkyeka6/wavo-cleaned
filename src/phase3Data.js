import { supabase } from './supabaseClient'
import { calculateGameMove } from './lib/wavo2GameRules.js'

function throwIf(error) {
  if (error) throw error
}

function minutesFromNow(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString()
}

async function safeRows(promise) {
  try {
    const { data, error } = await promise
    if (error) return []
    return data || []
  } catch {
    return []
  }
}

export async function getActiveTemporaryLocations() {
  const { data, error } = await supabase
    .from('temporary_location_shares')
    .select('*')
    .gt('expires_at', new Date().toISOString())
    .order('updated_at', { ascending: false })
  throwIf(error)
  return data || []
}

export async function shareTemporaryLocation(ownerId, {
  audience = [],
  label = 'I’m here',
  latitude,
  longitude,
  precisionM = 250,
  approximate = true,
  minutes = 30,
}) {
  const cleanAudience = [...new Set(audience)].filter((id) => id && id !== ownerId)
  const cleanLabel = String(label || 'I’m here').trim().slice(0, 80) || 'I’m here'
  const { data, error } = await supabase
    .from('temporary_location_shares')
    .upsert({
      owner_id: ownerId,
      audience: cleanAudience,
      label: cleanLabel,
      latitude: Number(latitude),
      longitude: Number(longitude),
      precision_m: Math.max(5, Math.min(5000, Math.round(Number(precisionM) || 250))),
      approximate: Boolean(approximate),
      updated_at: new Date().toISOString(),
      expires_at: minutesFromNow(Math.max(5, Math.min(240, Number(minutes) || 30))),
    }, { onConflict: 'owner_id' })
    .select('*')
    .single()
  throwIf(error)
  return data
}

export async function stopTemporaryLocation(ownerId) {
  const { error } = await supabase
    .from('temporary_location_shares')
    .delete()
    .eq('owner_id', ownerId)
  throwIf(error)
}

function initialGameState(kind, creatorId) {
  if (kind === 'tic_tac_toe') {
    return { board: Array(9).fill(null), turn: creatorId, winner: null }
  }
  if (kind === 'connect4') {
    return { board: Array(42).fill(null), turn: creatorId, winner: null }
  }
  throw new Error('Unsupported game.')
}

export async function startPhase3Game(creatorId, opponentId, kind) {
  if (!['tic_tac_toe', 'connect4'].includes(kind)) throw new Error('Unsupported game.')
  const { data, error } = await supabase
    .from('chat_games')
    .insert({
      creator_id: creatorId,
      opponent_id: opponentId,
      kind,
      state: initialGameState(kind, creatorId),
      status: 'active',
    })
    .select('*')
    .single()
  throwIf(error)
  return data
}

export async function playPhase3Game(gameId, userId, move) {
  const { data: game, error: loadError } = await supabase
    .from('chat_games')
    .select('*')
    .eq('id', gameId)
    .single()
  throwIf(loadError)

  // Preserve the current client contract for finished or cancelled games.
  if (game.status !== 'active') return game

  // Reuse the same validated transition for both supported board games.
  // This is client validation only; the database must enforce it as well.
  const { state, status } = calculateGameMove(game, userId, move)
  const { data: updated, error } = await supabase
    .from('chat_games')
    .update({
      state,
      status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', game.id)
    .eq('updated_at', game.updated_at)
    .select('*')
    .maybeSingle()
  throwIf(error)
  if (!updated) throw new Error('The game changed at the same time. Try that move again.')
  return updated
}

export async function getPhase3Recap(userId) {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const [calls, knocks, responses, games, dms, spaceMessages] = await Promise.all([
    safeRows(supabase.from('call_sessions').select('id,caller_id,callee_id,mode,status,created_at,updated_at').or(`caller_id.eq.${userId},callee_id.eq.${userId}`).gte('created_at', weekAgo).order('created_at', { ascending: false }).limit(200)),
    safeRows(supabase.from('wavo_knocks').select('id,sender_id,receiver_id,response,created_at').or(`sender_id.eq.${userId},receiver_id.eq.${userId}`).gte('created_at', weekAgo).order('created_at', { ascending: false }).limit(200)),
    safeRows(supabase.from('come_responses').select('invite_id,user_id,response,updated_at').eq('user_id', userId).gte('updated_at', weekAgo).limit(200)),
    safeRows(supabase.from('chat_games').select('*').or(`creator_id.eq.${userId},opponent_id.eq.${userId}`).gte('created_at', weekAgo).order('created_at', { ascending: false }).limit(200)),
    safeRows(supabase.from('messages').select('id,sender_id,created_at').eq('sender_id', userId).gte('created_at', weekAgo).limit(1000)),
    safeRows(supabase.from('group_messages').select('id,sender_id,created_at').eq('sender_id', userId).gte('created_at', weekAgo).limit(1000)),
  ])
  return { calls, knocks, responses, games, dms, spaceMessages }
}
