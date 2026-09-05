import { supabase } from './supabaseClient'

const DEFAULTS = {
  availability: 'active',
  activity_kind: 'status',
  activity_text: null,
  activity_emoji: null,
  share_presence: false,
  share_activity: false,
  share_music: false,
  share_gaming: false,
  audience_mode: 'nobody',
  audience: [],
}

export async function getOwnPresence(userId) {
  if (!userId) return null
  const { data, error } = await supabase
    .from('wavo_presence')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data || { user_id: userId, ...DEFAULTS }
}

export async function heartbeatPresence(userId) {
  if (!userId) return
  const now = new Date().toISOString()
  const { data: existing, error: readError } = await supabase
    .from('wavo_presence')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (readError) throw readError

  if (existing) {
    const { error } = await supabase
      .from('wavo_presence')
      .update({ last_seen: now, updated_at: now })
      .eq('user_id', userId)
    if (error) throw error
    return
  }

  const { error } = await supabase.from('wavo_presence').insert({
    user_id: userId,
    ...DEFAULTS,
    last_seen: now,
    updated_at: now,
  })
  if (error) throw error
}

export async function savePresence(userId, patch = {}) {
  if (!userId) throw new Error('You are not signed in.')
  const current = await getOwnPresence(userId)
  const now = new Date().toISOString()
  const next = {
    user_id: userId,
    availability: patch.availability ?? current.availability ?? 'active',
    activity_kind: patch.activity_kind ?? current.activity_kind ?? 'status',
    activity_text: patch.activity_text === undefined ? current.activity_text : (patch.activity_text?.trim() || null),
    activity_emoji: patch.activity_emoji === undefined ? current.activity_emoji : (patch.activity_emoji?.trim() || null),
    share_presence: patch.share_presence ?? current.share_presence ?? false,
    share_activity: patch.share_activity ?? current.share_activity ?? false,
    share_music: patch.share_music ?? current.share_music ?? false,
    share_gaming: patch.share_gaming ?? current.share_gaming ?? false,
    audience_mode: patch.audience_mode ?? current.audience_mode ?? 'nobody',
    audience: Array.isArray(patch.audience) ? patch.audience : (current.audience || []),
    last_seen: now,
    activity_expires_at: patch.activity_expires_at === undefined ? current.activity_expires_at : patch.activity_expires_at,
    updated_at: now,
  }

  const { data, error } = await supabase
    .from('wavo_presence')
    .upsert(next, { onConflict: 'user_id' })
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function setPresenceActivity(userId, { kind = 'status', text = '', emoji = '', hours = 2 } = {}) {
  const expires = text.trim()
    ? new Date(Date.now() + Math.max(1, Number(hours) || 2) * 60 * 60 * 1000).toISOString()
    : null
  return savePresence(userId, {
    activity_kind: kind,
    activity_text: text,
    activity_emoji: emoji,
    activity_expires_at: expires,
  })
}

export async function getVisiblePresence() {
  const { data, error } = await supabase.rpc('get_visible_presence')
  if (error) throw error
  return data || []
}

export function presenceLabel(row) {
  if (!row) return 'Offline'
  const ago = Date.now() - new Date(row.last_seen || 0).getTime()
  if (ago <= 3 * 60 * 1000) {
    if (row.availability === 'free') return 'Free to talk'
    if (row.availability === 'busy') return 'Busy'
    if (row.availability === 'away') return 'Away'
    return 'Active now'
  }
  if (ago <= 30 * 60 * 1000) return 'Recently active'
  return 'Offline'
}

export function presenceRank(row) {
  const label = presenceLabel(row)
  if (label === 'Free to talk') return 0
  if (label === 'Active now') return 1
  if (label === 'Busy') return 2
  if (label === 'Recently active') return 3
  return 4
}
