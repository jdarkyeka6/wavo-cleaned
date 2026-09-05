import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Phone, Video } from 'lucide-react'
import { supabase } from './supabaseClient'
import './call-continuity.css'

function cleanUsername(value) {
  const clean = String(value || '').trim().replace(/^@/, '')
  if (!clean || clean.toLowerCase() === 'wavo friend') return ''
  return clean
}

function peerUsername() {
  const topbar = document.querySelector('.chat-screen .chat-topbar')
  if (!topbar) return ''
  const canonical = cleanUsername(topbar.querySelector('.wavo-call-peer-username')?.textContent)
  if (canonical) return canonical
  const strongs = [...topbar.querySelectorAll('strong')].map((node) => cleanUsername(node.textContent)).filter(Boolean)
  return strongs.at(-1) || ''
}

function relative(ts) {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 60000))
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`
  return `${Math.floor(mins / 1440)}d ago`
}

function duration(call) {
  if (call.status !== 'ended') return ''
  const ms = Math.max(0, new Date(call.updated_at).getTime() - new Date(call.created_at).getTime())
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return '<1 min'
  if (mins < 60) return `${mins} min`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

function statusText(call) {
  if (call.status === 'declined') return 'Declined'
  if (call.status === 'missed') return 'Missed'
  if (call.status === 'cancelled') return 'Cancelled'
  return duration(call) || 'Ended'
}

function ContinuityCards({ calls }) {
  if (!calls.length) return null
  return (
    <div className="wavo-call-continuity" aria-label="Recent calls">
      {calls.map((call) => {
        const Icon = call.mode === 'video' ? Video : Phone
        return (
          <div className="wavo-call-history-card" key={call.id}>
            <span className="wavo-call-history-icon"><Icon size={14} /></span>
            <div><strong>{call.mode === 'video' ? 'Video call' : 'Voice call'}</strong><small>{statusText(call)} · {relative(call.created_at)}</small></div>
          </div>
        )
      })}
    </div>
  )
}

export default function CallContinuityBridge() {
  const [container, setContainer] = useState(null)
  const [calls, setCalls] = useState([])

  useEffect(() => {
    let disposed = false
    let lastKey = ''

    async function sync() {
      const messages = document.querySelector('.chat-screen .dm-messages')
      const username = peerUsername()
      if (!messages || !username) {
        if (!disposed) {
          setContainer(null)
          setCalls([])
          lastKey = ''
        }
        return
      }

      if (!disposed) setContainer(messages)
      const { data: auth } = await supabase.auth.getUser()
      const me = auth?.user?.id
      if (!me) return
      const { data: peer, error: peerError } = await supabase
        .from('profiles')
        .select('id,username')
        .ilike('username', username)
        .limit(1)
        .maybeSingle()
      if (disposed || peerError || !peer?.id) return
      const key = `${me}:${peer.id}`
      if (key === lastKey) return
      lastKey = key

      const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
      const filter = `and(caller_id.eq.${me},callee_id.eq.${peer.id}),and(caller_id.eq.${peer.id},callee_id.eq.${me})`
      const { data, error } = await supabase
        .from('call_sessions')
        .select('id,caller_id,callee_id,mode,status,created_at,updated_at')
        .or(filter)
        .in('status', ['ended', 'declined', 'missed', 'cancelled'])
        .gte('created_at', cutoff)
        .order('created_at', { ascending: false })
        .limit(3)
      if (!disposed && !error) setCalls(data || [])
    }

    const observer = new MutationObserver(() => sync().catch(() => {}))
    observer.observe(document.body, { childList: true, subtree: true })
    sync().catch(() => {})
    const timer = window.setInterval(() => {
      lastKey = ''
      sync().catch(() => {})
    }, 20000)

    return () => {
      disposed = true
      observer.disconnect()
      window.clearInterval(timer)
    }
  }, [])

  if (!container || !calls.length) return null
  return createPortal(<ContinuityCards calls={calls} />, container)
}
