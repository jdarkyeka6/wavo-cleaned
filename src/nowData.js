import { supabase } from './supabaseClient'

const DEFAULT_SHARING = {
  audience: [],
  share_presence: false,
  share_status: false,
  share_spotify: false,
  share_gaming: false,
  invisible: false,
}

async function getAudience(userId) {
  const { data, error } = await supabase
    .from('activity_sharing_recipients')
    .select('viewer_id')
    .eq('owner_id', userId)
  if (error) throw error
  return (data || []).map((row) => row.viewer_id)
}

export async function getActivitySharing(userId) {
  const [{ data, error }, audience] = await Promise.all([
    supabase.from('activity_sharing').select('*').eq('owner_id', userId).maybeSingle(),
    getAudience(userId),
  ])

  if (error) throw error
  if (data) return { ...data, audience }

  const { data: created, error: createError } = await supabase
    .from('activity_sharing')
    .insert({
      owner_id: userId,
      share_presence: DEFAULT_SHARING.share_presence,
      share_status: DEFAULT_SHARING.share_status,
      share_spotify: DEFAULT_SHARING.share_spotify,
      share_gaming: DEFAULT_SHARING.share_gaming,
      invisible: DEFAULT_SHARING.invisible,
    })
    .select('*')
    .single()

  if (createError) throw createError
  return { ...created, audience: [] }
}

export async function updateActivitySharing(userId, patch) {
  const { audience, ...settingsPatch } = patch

  let settings
  if (Object.keys(settingsPatch).length) {
    const { data, error } = await supabase
      .from('activity_sharing')
      .upsert({ owner_id: userId, ...settingsPatch, updated_at: new Date().toISOString() }, { onConflict: 'owner_id' })
      .select('*')
      .single()
    if (error) throw error
    settings = data
  } else {
    const { data, error } = await supabase.from('activity_sharing').select('*').eq('owner_id', userId).single()
    if (error) throw error
    settings = data
  }

  if (Array.isArray(audience)) {
    const unique = [...new Set(audience)].filter((id) => id && id !== userId)
    const { error: deleteError } = await supabase
      .from('activity_sharing_recipients')
      .delete()
      .eq('owner_id', userId)
    if (deleteError) throw deleteError

    if (unique.length) {
      const { error: insertError } = await supabase
        .from('activity_sharing_recipients')
        .insert(unique.map((viewerId) => ({ owner_id: userId, viewer_id: viewerId })))
      if (insertError) throw insertError
    }
  }

  return { ...settings, audience: Array.isArray(audience) ? [...new Set(audience)] : await getAudience(userId) }
}

export async function getVisibleNow() {
  const { data, error } = await supabase
    .from('activity_now')
    .select('owner_id,kind,payload,updated_at,expires_at')
    .gt('expires_at', new Date().toISOString())
    .order('updated_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function publishNow(userId, sharing, profileStatus = '') {
  if (!userId || !sharing) return

  const visible = !sharing.invisible
  const expiresAt = new Date(Date.now() + 100_000).toISOString()
  const rows = []

  if (visible && sharing.share_presence) {
    rows.push({
      owner_id: userId,
      kind: 'presence',
      payload: { state: 'online' },
      updated_at: new Date().toISOString(),
      expires_at: expiresAt,
    })
  }

  if (visible && sharing.share_status && profileStatus?.trim()) {
    rows.push({
      owner_id: userId,
      kind: 'status',
      payload: { text: profileStatus.trim() },
      updated_at: new Date().toISOString(),
      expires_at: expiresAt,
    })
  }

  const enabledKinds = new Set(rows.map((row) => row.kind))
  const toDelete = ['presence', 'status'].filter((kind) => !enabledKinds.has(kind))

  if (rows.length) {
    const { error } = await supabase
      .from('activity_now')
      .upsert(rows, { onConflict: 'owner_id,kind' })
    if (error) throw error
  }

  if (toDelete.length) {
    const { error } = await supabase
      .from('activity_now')
      .delete()
      .eq('owner_id', userId)
      .in('kind', toDelete)
    if (error) throw error
  }
}

export async function clearPresence(userId) {
  if (!userId) return
  const { error } = await supabase
    .from('activity_now')
    .delete()
    .eq('owner_id', userId)
    .in('kind', ['presence', 'status'])
  if (error) throw error
}
