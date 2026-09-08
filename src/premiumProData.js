import { supabase } from './supabaseClient'

export function paidTier(profile) {
  const active = Boolean(profile?.is_premium) && (!profile?.premium_until || new Date(profile.premium_until) > new Date())
  if (!active) return 'free'
  const tier = String(profile?.tier || 'premium').toLowerCase()
  return tier === 'vip' ? 'pro' : tier
}

export async function getPremiumSettings() {
  const { data, error } = await supabase.rpc('get_or_create_premium_settings')
  if (error) throw error
  return data
}

export async function savePremiumSettings(userId, patch) {
  const { data, error } = await supabase
    .from('user_premium_settings')
    .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function getChatPreference(userId, kind, targetId) {
  const { data, error } = await supabase
    .from('chat_preferences')
    .select('*')
    .eq('user_id', userId)
    .eq('kind', kind)
    .eq('target_id', String(targetId))
    .maybeSingle()
  if (error) throw error
  return data
}

export async function saveChatPreference(userId, kind, targetId, patch) {
  const { data, error } = await supabase
    .from('chat_preferences')
    .upsert({ user_id: userId, kind, target_id: String(targetId), ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id,kind,target_id' })
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function getChatFolders(userId) {
  const [{ data: folders, error: folderError }, { data: items, error: itemError }] = await Promise.all([
    supabase.from('chat_folders').select('*').eq('user_id', userId).order('sort_order').order('created_at'),
    supabase.from('chat_folder_items').select('*').eq('user_id', userId).order('sort_order').order('created_at'),
  ])
  if (folderError) throw folderError
  if (itemError) throw itemError
  return (folders || []).map((folder) => ({ ...folder, items: (items || []).filter((item) => item.folder_id === folder.id) }))
}

export async function createChatFolder(userId, name, icon = '💬') {
  const { data, error } = await supabase.from('chat_folders').insert({ user_id: userId, name: name.trim(), icon }).select('*').single()
  if (error) throw error
  return data
}

export async function setFolderItem(userId, folderId, kind, targetId, enabled) {
  if (enabled) {
    const { error } = await supabase.from('chat_folder_items').upsert({ folder_id: folderId, user_id: userId, kind, target_id: String(targetId) }, { onConflict: 'folder_id,kind,target_id' })
    if (error) throw error
  } else {
    const { error } = await supabase.from('chat_folder_items').delete().eq('folder_id', folderId).eq('user_id', userId).eq('kind', kind).eq('target_id', String(targetId))
    if (error) throw error
  }
}

export async function getStreakState() {
  const { data, error } = await supabase.rpc('get_streak_state')
  if (error) throw error
  return data
}

export async function repairStreak() {
  const { data, error } = await supabase.rpc('repair_streak')
  if (error) throw error
  return data
}

export async function addMessageReaction({ messageKind, messageId, userId, emoji, effect = null }) {
  const { error } = await supabase.from('message_reactions').upsert({
    message_kind: messageKind,
    message_id: messageId,
    user_id: userId,
    emoji,
    effect,
  }, { onConflict: 'message_kind,message_id,user_id,emoji' })
  if (error) throw error
}

export async function getMessageReactions(messageKind, ids) {
  if (!ids?.length) return []
  const { data, error } = await supabase.from('message_reactions').select('*').eq('message_kind', messageKind).in('message_id', ids)
  if (error) throw error
  return data || []
}

export async function setMessageEffect(messageKind, messageId, userId, effect) {
  const table = messageKind === 'space' ? 'group_messages' : 'messages'
  let query = supabase.from(table).update({ effect: effect || null }).eq('id', messageId)
  query = messageKind === 'space' ? query.or(`sender_id.eq.${userId},user_id.eq.${userId}`) : query.eq('sender_id', userId)
  const { error } = await query
  if (error) throw error
}

export async function moderateContent(text, imageUrl = '') {
  const { data, error } = await supabase.functions.invoke('moderate-content', { body: { text, imageUrl } })
  if (error) throw error
  return data || { allowed: true }
}

export async function proAi(action, body = {}) {
  const { data, error } = await supabase.functions.invoke('wavo-pro-ai', { body: { action, ...body } })
  if (error) throw error
  if (data?.error) throw new Error(data.message || data.error)
  return data
}

export async function getSpaceStats(groupId) {
  const { data, error } = await supabase.rpc('get_space_pro_stats', { p_group_id: groupId })
  if (error) throw error
  return data
}
