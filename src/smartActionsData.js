import { supabase } from './supabaseClient'
import { optionalBackend } from './lib/optionalBackend'

export async function createDmPoll(creatorId, receiverId, question, options = []) {
  const cleanQuestion = String(question || '').trim().slice(0, 240)
  const cleanOptions = [...new Set(options.map((value) => String(value || '').trim()).filter(Boolean))].slice(0, 6)
  if (!cleanQuestion || cleanOptions.length < 2) throw new Error('A poll needs a question and at least two options.')
  if (optionalBackend.unavailable('dm_polls')) throw new Error('DM polls are temporarily unavailable.')
  const { data, error } = await supabase
    .from('dm_polls')
    .insert({
      creator_id: creatorId,
      receiver_id: receiverId,
      question: cleanQuestion,
      options: cleanOptions,
      closes_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    .select('*')
    .single()
  if (error) {
    if (optionalBackend.markMissing('dm_polls', error)) throw new Error('DM polls are temporarily unavailable.')
    throw error
  }
  return data
}

export async function getDmPolls(me, peer) {
  if (!me || !peer || optionalBackend.unavailable('dm_polls')) return []
  const filter = `and(creator_id.eq.${me},receiver_id.eq.${peer}),and(creator_id.eq.${peer},receiver_id.eq.${me})`
  const { data: polls, error } = await supabase
    .from('dm_polls')
    .select('*')
    .or(filter)
    .order('created_at', { ascending: false })
    .limit(8)
  if (error) {
    if (optionalBackend.markMissing('dm_polls', error)) return []
    throw error
  }
  if (!polls?.length) return []
  const { data: votes, error: voteError } = await supabase
    .from('dm_poll_votes')
    .select('*')
    .in('poll_id', polls.map((poll) => poll.id))
  if (voteError) throw voteError
  return polls.map((poll) => ({ ...poll, votes: (votes || []).filter((vote) => vote.poll_id === poll.id) }))
}

export async function voteDmPoll(pollId, userId, optionIndex) {
  if (optionalBackend.unavailable('dm_polls')) throw new Error('DM polls are temporarily unavailable.')
  const { data, error } = await supabase
    .from('dm_poll_votes')
    .upsert({ poll_id: pollId, user_id: userId, option_index: optionIndex, updated_at: new Date().toISOString() }, { onConflict: 'poll_id,user_id' })
    .select('*')
    .single()
  if (error) {
    if (optionalBackend.markMissing('dm_polls', error)) throw new Error('DM polls are temporarily unavailable.')
    throw error
  }
  return data
}

export async function createScheduledCome(ownerId, peerId, { title, startsAt, durationHours = 2 } = {}) {
  const start = startsAt ? new Date(startsAt) : new Date()
  if (Number.isNaN(start.getTime())) throw new Error('Could not understand that time.')
  const end = new Date(start.getTime() + Math.max(.5, Number(durationHours) || 2) * 60 * 60 * 1000)
  const { data, error } = await supabase
    .from('come_invites')
    .insert({
      owner_id: ownerId,
      title: String(title || 'Hang out').trim().slice(0, 80),
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      audience: [peerId],
    })
    .select('*')
    .single()
  if (error) throw error
  return data
}
