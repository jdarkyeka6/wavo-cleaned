import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

async function readActivity(userId, friendId) {
  const chatId = [userId, friendId].sort().join('_')
  const [latest, unread] = await Promise.all([
    supabase.from('messages').select('created_at').eq('chat_id', chatId).is('deleted_at', null).order('created_at', { ascending: false }).limit(1),
    supabase.from('messages').select('id').eq('chat_id', chatId).eq('receiver_id', userId).eq('is_read', false).is('deleted_at', null).limit(1),
  ])
  if (latest.error || unread.error) throw latest.error || unread.error
  return { latestAt: latest.data?.[0]?.created_at || null, unread: Boolean(unread.data?.length) }
}

export function useInboxActivity(userId, friends, activeFriendId) {
  const idsKey = friends.map(f => f.id).filter(Boolean).sort().join(',')
  const [snapshot, setSnapshot] = useState({ userId: null, activity: {} })
  useEffect(() => {
    if (!userId || !idsKey) return
    const ids = idsKey.split(',')
    const known = new Set(ids)
    const queue = new Set()
    let alive = true, working = false, timer
    const load = async () => {
      if (!alive || working) return
      working = true
      try {
        while (alive && queue.size) {
          const batch = [...queue].slice(0, 6)
          batch.forEach(id => queue.delete(id))
          const rows = await Promise.all(batch.map(async id => {
            try { return [id, await readActivity(userId, id)] }
            catch { return null }
          }))
          if (!alive) return
          setSnapshot(previous => ({
            userId,
            activity: { ...(previous.userId === userId ? previous.activity : {}), ...Object.fromEntries(rows.filter(Boolean)) },
          }))
        }
      } finally { working = false }
    }
    const refresh = (id) => {
      if (id && known.has(id)) queue.add(id)
      else if (!id) ids.forEach(value => queue.add(value))
      clearTimeout(timer)
      timer = setTimeout(load, 120)
    }
    const changed = ({ new: row, old }) => {
      const message = row?.sender_id ? row : old
      if (!message?.sender_id || !message?.receiver_id) return refresh()
      const other = message.sender_id === userId ? message.receiver_id : message.sender_id
      refresh(other)
    }
    const channel = supabase.channel('wavo-inbox-activity:' + userId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: 'receiver_id=eq.' + userId }, changed)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: 'sender_id=eq.' + userId }, changed)
      .subscribe(status => { if (status === 'SUBSCRIBED') refresh() })
    const onFocus = () => { if (document.visibilityState === 'visible') refresh() }
    const onRead = event => refresh(event.detail?.friendId)
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onFocus)
    window.addEventListener('wavo:dm-read', onRead)
    document.addEventListener('visibilitychange', onFocus)
    const interval = setInterval(onFocus, 60000)
    refresh()
    return () => {
      alive = false
      clearTimeout(timer); clearInterval(interval)
      supabase.removeChannel(channel)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onFocus)
      window.removeEventListener('wavo:dm-read', onRead)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [userId, idsKey])
  useEffect(() => {
    if (userId && activeFriendId) window.dispatchEvent(new CustomEvent('wavo:dm-read', { detail: { friendId: activeFriendId } }))
  }, [userId, activeFriendId])
  return snapshot.userId === userId ? snapshot.activity : {}
}
