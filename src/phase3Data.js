import { supabase } from './supabaseClient'

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

function ticTacToeWinner(board) {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ]
  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a]
  }
  return board.every(Boolean) ? 'draw' : null
}

function connect4Winner(board) {
  const at = (row, col) => board[row * 7 + col]
  const directions = [[0, 1], [1, 0], [1, 1], [1, -1]]
  for (let row = 0; row < 6; row += 1) {
    for (let col = 0; col < 7; col += 1) {
      const token = at(row, col)
      if (!token) continue
      for (const [dr, dc] of directions) {
        let ok = true
        for (let step = 1; step < 4; step += 1) {
          const rr = row + dr * step
          const cc = col + dc * step
          if (rr < 0 || rr >= 6 || cc < 0 || cc >= 7 || at(rr, cc) !== token) {
            ok = false
            break
          }
        }
        if (ok) return token
      }
    }
  }
  return board.every(Boolean) ? 'draw' : null
}

export async function playPhase3Game(gameId, userId, move) {
  const { data: game, error: loadError } = await supabase
    .from('chat_games')
    .select('*')
    .eq('id', gameId)
    .single()
  throwIf(loadError)
  if (game.status !== 'active') return game
  if (![game.creator_id, game.opponent_id].includes(userId)) throw new Error('You are not in this game.')
  if (game.state?.turn !== userId) throw new Error('It is not your turn yet.')

  const token = userId === game.creator_id ? 'a' : 'b'
  const otherId = userId === game.creator_id ? game.opponent_id : game.creator_id
  let board = [...(game.state?.board || [])]
  let winnerToken = null

  if (game.kind === 'tic_tac_toe') {
    const cell = Number(move)
    if (!Number.isInteger(cell) || cell < 0 || cell > 8 || board[cell]) throw new Error('Pick an empty square.')
    board[cell] = token
    winnerToken = ticTacToeWinner(board)
  } else if (game.kind === 'connect4') {
    const column = Number(move)
    if (!Number.isInteger(column) || column < 0 || column > 6) throw new Error('Pick a column.')
    let placed = false
    for (let row = 5; row >= 0; row -= 1) {
      const index = row * 7 + column
      if (!board[index]) {
        board[index] = token
        placed = true
        break
      }
    }
    if (!placed) throw new Error('That column is full.')
    winnerToken = connect4Winner(board)
  } else {
    throw new Error('Unsupported game.')
  }

  const winner = winnerToken === 'draw'
    ? 'draw'
    : winnerToken === 'a'
      ? game.creator_id
      : winnerToken === 'b'
        ? game.opponent_id
        : null
  const finished = Boolean(winner)
  const nextState = {
    ...game.state,
    board,
    turn: finished ? null : otherId,
    winner,
  }

  const { data: updated, error } = await supabase
    .from('chat_games')
    .update({
      state: nextState,
      status: finished ? 'finished' : 'active',
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
