import { supabase } from './supabaseClient'

function throwIf(error) {
  if (error) throw error
}

function isoAfterHours(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
}

export async function getTogetherSnapshot(userId) {
  if (!userId) return null
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const now = new Date().toISOString()

  const [
    statusesRes,
    knocksRes,
    invitesRes,
    circlesRes,
    roomsRes,
    queuesRes,
    gamesRes,
    callsRes,
  ] = await Promise.all([
    supabase.from('wavo_statuses').select('*').gt('expires_at', now).order('updated_at', { ascending: false }),
    supabase.from('wavo_knocks').select('*').gt('expires_at', now).order('created_at', { ascending: false }).limit(50),
    supabase.from('come_invites').select('*').gt('ends_at', weekAgo).order('created_at', { ascending: false }).limit(50),
    supabase.from('friend_circles').select('*').order('created_at', { ascending: true }),
    supabase.from('dropin_rooms').select('*').eq('is_open', true).order('created_at', { ascending: false }).limit(30),
    supabase.from('shared_queues').select('*').eq('is_active', true).order('created_at', { ascending: false }).limit(20),
    supabase.from('chat_games').select('*').order('created_at', { ascending: false }).limit(30),
    supabase.from('call_sessions').select('id,caller_id,callee_id,mode,status,created_at,updated_at').gte('created_at', weekAgo).order('created_at', { ascending: false }).limit(100),
  ])

  ;[statusesRes, knocksRes, invitesRes, circlesRes, roomsRes, queuesRes, gamesRes, callsRes].forEach((result) => throwIf(result.error))

  const inviteIds = (invitesRes.data || []).map((row) => row.id)
  const circleIds = (circlesRes.data || []).map((row) => row.id)
  const roomIds = (roomsRes.data || []).map((row) => row.id)
  const queueIds = (queuesRes.data || []).map((row) => row.id)

  const [responsesRes, circleMembersRes, roomMembersRes, queueItemsRes] = await Promise.all([
    inviteIds.length ? supabase.from('come_responses').select('*').in('invite_id', inviteIds) : Promise.resolve({ data: [], error: null }),
    circleIds.length ? supabase.from('friend_circle_members').select('*').in('circle_id', circleIds) : Promise.resolve({ data: [], error: null }),
    roomIds.length ? supabase.from('dropin_room_members').select('*').in('room_id', roomIds) : Promise.resolve({ data: [], error: null }),
    queueIds.length ? supabase.from('shared_queue_items').select('*').in('queue_id', queueIds).order('created_at', { ascending: true }) : Promise.resolve({ data: [], error: null }),
  ])

  ;[responsesRes, circleMembersRes, roomMembersRes, queueItemsRes].forEach((result) => throwIf(result.error))

  return {
    statuses: statusesRes.data || [],
    knocks: knocksRes.data || [],
    invites: (invitesRes.data || []).map((invite) => ({
      ...invite,
      responses: (responsesRes.data || []).filter((response) => response.invite_id === invite.id),
    })),
    circles: (circlesRes.data || []).map((circle) => ({
      ...circle,
      members: (circleMembersRes.data || []).filter((member) => member.circle_id === circle.id),
    })),
    rooms: (roomsRes.data || []).map((room) => ({
      ...room,
      members: (roomMembersRes.data || []).filter((member) => member.room_id === room.id),
    })),
    queues: (queuesRes.data || []).map((queue) => ({
      ...queue,
      items: (queueItemsRes.data || []).filter((item) => item.queue_id === queue.id),
    })),
    games: gamesRes.data || [],
    calls: callsRes.data || [],
  }
}

export async function setExpiringStatus(userId, text, hours = 2, emoji = '') {
  const clean = String(text || '').trim().slice(0, 120)
  if (!clean) throw new Error('Write a status first.')
  const { data, error } = await supabase
    .from('wavo_statuses')
    .upsert({ user_id: userId, text: clean, emoji: emoji || null, expires_at: isoAfterHours(hours), updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    .select('*')
    .single()
  throwIf(error)
  return data
}

export async function clearExpiringStatus(userId) {
  const { error } = await supabase.from('wavo_statuses').delete().eq('user_id', userId)
  throwIf(error)
}

export async function sendKnock(senderId, receiverId) {
  const { data, error } = await supabase
    .from('wavo_knocks')
    .insert({ sender_id: senderId, receiver_id: receiverId })
    .select('*')
    .single()
  throwIf(error)
  return data
}

export async function respondKnock(knockId, response) {
  const { data, error } = await supabase
    .from('wavo_knocks')
    .update({ response, responded_at: new Date().toISOString() })
    .eq('id', knockId)
    .select('*')
    .single()
  throwIf(error)
  return data
}

export async function createComeInvite(ownerId, { title, location = '', note = '', durationHours = 2, audience = [] }) {
  const cleanTitle = String(title || '').trim().slice(0, 80)
  if (!cleanTitle) throw new Error('Give it a name first.')
  const startsAt = new Date()
  const endsAt = new Date(startsAt.getTime() + Math.max(0.5, Number(durationHours) || 2) * 60 * 60 * 1000)
  const { data, error } = await supabase
    .from('come_invites')
    .insert({
      owner_id: ownerId,
      title: cleanTitle,
      location: String(location || '').trim().slice(0, 120) || null,
      note: String(note || '').trim().slice(0, 240) || null,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      audience,
    })
    .select('*')
    .single()
  throwIf(error)
  return data
}

export async function setComeResponse(inviteId, userId, response) {
  const { data, error } = await supabase
    .from('come_responses')
    .upsert({ invite_id: inviteId, user_id: userId, response, updated_at: new Date().toISOString() }, { onConflict: 'invite_id,user_id' })
    .select('*')
    .single()
  throwIf(error)
  return data
}

export async function createFriendCircle(ownerId, { name, emoji = '👥', members = [] }) {
  const clean = String(name || '').trim().slice(0, 40)
  if (!clean) throw new Error('Name the circle first.')
  const { data: circle, error } = await supabase
    .from('friend_circles')
    .insert({ owner_id: ownerId, name: clean, emoji })
    .select('*')
    .single()
  throwIf(error)
  if (members.length) {
    const { error: memberError } = await supabase
      .from('friend_circle_members')
      .insert([...new Set(members)].map((userId) => ({ circle_id: circle.id, user_id: userId })))
    throwIf(memberError)
  }
  return circle
}

export async function deleteFriendCircle(circleId) {
  const { error } = await supabase.from('friend_circles').delete().eq('id', circleId)
  throwIf(error)
}

export async function createDropinRoom(ownerId, { title, audience = [] }) {
  const clean = String(title || '').trim().slice(0, 80)
  if (!clean) throw new Error('Name the room first.')
  const { data, error } = await supabase
    .from('dropin_rooms')
    .insert({ owner_id: ownerId, title: clean, audience })
    .select('*')
    .single()
  throwIf(error)
  await setDropinMembership(data.id, ownerId, true)
  return data
}

export async function setDropinMembership(roomId, userId, joined) {
  if (joined) {
    const { error } = await supabase.from('dropin_room_members').upsert({ room_id: roomId, user_id: userId }, { onConflict: 'room_id,user_id' })
    throwIf(error)
  } else {
    const { error } = await supabase.from('dropin_room_members').delete().eq('room_id', roomId).eq('user_id', userId)
    throwIf(error)
  }
}

export async function closeDropinRoom(roomId) {
  const { error } = await supabase.from('dropin_rooms').update({ is_open: false, closed_at: new Date().toISOString() }).eq('id', roomId)
  throwIf(error)
}

export async function createSharedQueue(ownerId, { title = 'Shared queue', audience = [] }) {
  const { data, error } = await supabase
    .from('shared_queues')
    .insert({ owner_id: ownerId, title: String(title || 'Shared queue').trim().slice(0, 80), audience })
    .select('*')
    .single()
  throwIf(error)
  return data
}

export async function addSharedQueueItem(queueId, userId, { title, url }) {
  const cleanTitle = String(title || '').trim().slice(0, 120)
  const cleanUrl = String(url || '').trim()
  if (!cleanTitle || !cleanUrl) throw new Error('Add a song name and link.')
  const { data, error } = await supabase
    .from('shared_queue_items')
    .insert({ queue_id: queueId, added_by: userId, title: cleanTitle, url: cleanUrl })
    .select('*')
    .single()
  throwIf(error)
  return data
}

export async function closeSharedQueue(queueId) {
  const { error } = await supabase.from('shared_queues').update({ is_active: false }).eq('id', queueId)
  throwIf(error)
}

export async function startChatGame(creatorId, opponentId, kind = 'rps') {
  const initialState = kind === 'coin' ? { result: Math.random() < 0.5 ? 'heads' : 'tails' } : { choices: {} }
  const { data, error } = await supabase
    .from('chat_games')
    .insert({ creator_id: creatorId, opponent_id: opponentId, kind, state: initialState, status: kind === 'coin' ? 'finished' : 'active' })
    .select('*')
    .single()
  throwIf(error)
  return data
}

export async function playRps(game, userId, choice) {
  if (!['rock', 'paper', 'scissors'].includes(choice)) return game
  const choices = { ...(game.state?.choices || {}), [userId]: choice }
  const done = Boolean(choices[game.creator_id] && choices[game.opponent_id])
  const { data, error } = await supabase
    .from('chat_games')
    .update({ state: { ...game.state, choices }, status: done ? 'finished' : 'active', updated_at: new Date().toISOString() })
    .eq('id', game.id)
    .select('*')
    .single()
  throwIf(error)
  return data
}

export function rpsResult(game, userId) {
  const choices = game?.state?.choices || {}
  const mine = choices[userId]
  const otherId = game.creator_id === userId ? game.opponent_id : game.creator_id
  const theirs = choices[otherId]
  if (!mine || !theirs) return null
  if (mine === theirs) return 'Draw'
  const wins = { rock: 'scissors', paper: 'rock', scissors: 'paper' }
  return wins[mine] === theirs ? 'You won' : 'You lost'
}
