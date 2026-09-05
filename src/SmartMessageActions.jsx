import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { BarChart3, CalendarPlus, Check, Hand, Phone, Sparkles, Video } from 'lucide-react'
import { supabase } from './supabaseClient'
import { detectMessageAction } from './messageActions'
import { sendKnock } from './togetherData'
import { createDmPoll, createScheduledCome, getDmPolls, voteDmPoll } from './smartActionsData'
import './smart-message-actions.css'

function cleanUsername(value) {
  const clean = String(value || '').trim().replace(/^@/, '')
  if (!clean || clean.toLowerCase() === 'wavo friend') return ''
  return clean
}

function usernameFromChat() {
  const topbar = document.querySelector('.chat-screen .chat-topbar')
  if (!topbar) return ''
  const canonical = cleanUsername(topbar.querySelector('.wavo-call-peer-username')?.textContent)
  if (canonical) return canonical
  const visible = [...topbar.querySelectorAll('strong')].map((node) => cleanUsername(node.textContent)).filter(Boolean)
  const secondary = [...topbar.querySelectorAll('span')].map((node) => cleanUsername(node.textContent)).find((value) => value.startsWith('@'))
  return cleanUsername(secondary) || visible.at(-1) || ''
}

async function resolvePeer() {
  const username = usernameFromChat()
  if (!username) return null
  const { data, error } = await supabase
    .from('profiles')
    .select('id,username,avatar_url,status')
    .ilike('username', username)
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

function actionIcon(type) {
  if (type === 'poll') return BarChart3
  if (type === 'plan') return CalendarPlus
  if (type === 'knock') return Hand
  if (type === 'video-call') return Video
  return Phone
}

function SmartBar({ action, busy, done, onAction }) {
  if (!action) return null
  const Icon = actionIcon(action.type)
  const incompletePoll = action.type === 'poll' && (action.options || []).length < 2
  return (
    <div className="smart-action-bar">
      <span className="smart-action-spark"><Sparkles size={14} /></span>
      <div className="smart-action-copy">
        <small>WAVO ACTION</small>
        <strong>{done || (incompletePoll ? 'Write it like “red or blue?”' : action.label)}</strong>
      </div>
      {!done && !incompletePoll && (
        <button disabled={busy} onClick={onAction}>
          <Icon size={15} />{busy ? 'Doing…' : 'Do it'}
        </button>
      )}
      {done && <Check className="smart-action-done" size={18} />}
    </div>
  )
}

function PollCard({ poll, me, onVote }) {
  const options = Array.isArray(poll.options) ? poll.options : []
  const myVote = (poll.votes || []).find((vote) => vote.user_id === me)?.option_index
  const total = (poll.votes || []).length
  return (
    <article className="smart-poll-card">
      <span className="smart-poll-label"><BarChart3 size={13} /> CHAT POLL</span>
      <strong>{poll.question}</strong>
      <div className="smart-poll-options">
        {options.map((option, index) => {
          const count = (poll.votes || []).filter((vote) => vote.option_index === index).length
          const pct = total ? Math.round((count / total) * 100) : 0
          return (
            <button key={`${poll.id}-${index}`} className={myVote === index ? 'selected' : ''} onClick={() => onVote(poll.id, index)}>
              <span>{option}</span><b>{pct}%</b><i style={{ width: `${pct}%` }} />
            </button>
          )
        })}
      </div>
      <small>{total} vote{total === 1 ? '' : 's'} · expires after a day</small>
    </article>
  )
}

function PollBridge({ userId }) {
  const [mount, setMount] = useState(null)
  const [peer, setPeer] = useState(null)
  const [polls, setPolls] = useState([])

  async function refresh() {
    if (!userId) return
    const nextPeer = await resolvePeer()
    setPeer(nextPeer)
    if (!nextPeer) {
      setPolls([])
      return
    }
    setPolls(await getDmPolls(userId, nextPeer.id))
  }

  useEffect(() => {
    let disposed = false
    function syncMount() {
      const messages = document.querySelector('.chat-screen .dm-messages')
      if (!messages) {
        setMount(null)
        return
      }
      let target = messages.querySelector(':scope > .smart-polls-mount')
      if (!target) {
        target = document.createElement('div')
        target.className = 'smart-polls-mount'
        messages.appendChild(target)
      }
      if (!disposed) setMount(target)
      refresh().catch(() => {})
    }
    const observer = new MutationObserver(syncMount)
    observer.observe(document.body, { childList: true, subtree: true })
    syncMount()
    const timer = window.setInterval(() => refresh().catch(() => {}), 12000)
    const onCreated = () => refresh().catch(() => {})
    window.addEventListener('wavo:smart-action-created', onCreated)
    return () => {
      disposed = true
      observer.disconnect()
      window.clearInterval(timer)
      window.removeEventListener('wavo:smart-action-created', onCreated)
      document.querySelector('.smart-polls-mount')?.remove()
    }
  }, [userId])

  async function vote(pollId, optionIndex) {
    await voteDmPoll(pollId, userId, optionIndex)
    await refresh()
  }

  if (!mount || !peer || !polls.length) return null
  return createPortal(
    <div className="smart-poll-stack">{polls.slice(0, 3).reverse().map((poll) => <PollCard key={poll.id} poll={poll} me={userId} onVote={vote} />)}</div>,
    mount,
  )
}

export default function SmartMessageActions() {
  const [session, setSession] = useState(null)
  const [mount, setMount] = useState(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')

  const userId = session?.user?.id
  const action = useMemo(() => detectMessageAction(text), [text])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data?.session || null))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => listener?.subscription?.unsubscribe?.()
  }, [])

  useEffect(() => {
    let input = null
    let composer = null
    let target = null

    function detach() {
      input?.removeEventListener('input', onInput)
      input = null
      composer = null
      if (target?.isConnected) target.remove()
      target = null
      setMount(null)
      setText('')
      setDone('')
    }

    function onInput(event) {
      setText(event.currentTarget.value || '')
      setDone('')
    }

    function sync() {
      const nextComposer = document.querySelector('.chat-screen .dm-composer')
      const nextInput = nextComposer?.querySelector('input:not([type="file"])')
      if (nextComposer === composer && nextInput === input) return
      detach()
      if (!nextComposer || !nextInput) return
      composer = nextComposer
      input = nextInput
      input.addEventListener('input', onInput)
      setText(input.value || '')
      target = document.createElement('div')
      target.className = 'smart-action-mount'
      composer.parentNode?.insertBefore(target, composer)
      setMount(target)
    }

    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true })
    sync()
    return () => {
      observer.disconnect()
      detach()
    }
  }, [])

  async function runAction() {
    if (!action || !userId || busy) return
    setBusy(true)
    setDone('')
    try {
      const peer = await resolvePeer()
      if (!peer) throw new Error('Could not identify this friend.')

      if (action.type === 'video-call' || action.type === 'voice-call') {
        const callButton = document.querySelector('.chat-screen .wavo-video-call-button')
        if (!callButton) throw new Error('Call controls are not ready yet.')
        callButton.click()
        setDone(action.type === 'video-call' ? 'Starting video call…' : 'Starting call…')
      } else if (action.type === 'knock') {
        await sendKnock(userId, peer.id)
        setDone('Knock sent 👊')
      } else if (action.type === 'plan') {
        await createScheduledCome(userId, peer.id, action)
        setDone('Come? created ⚡')
        document.querySelector('.wt-launcher')?.classList.add('smart-action-pulse')
      } else if (action.type === 'poll') {
        await createDmPoll(userId, peer.id, action.question, action.options)
        setDone('Poll added below')
      }

      window.dispatchEvent(new CustomEvent('wavo:smart-action-created', { detail: { type: action.type } }))
      window.setTimeout(() => setDone(''), 3500)
    } catch (err) {
      console.error('[wavo smart actions]', err)
      setDone(err?.message || 'That action failed.')
      window.setTimeout(() => setDone(''), 4500)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {mount && createPortal(<SmartBar action={action} busy={busy} done={done} onAction={runAction} />, mount)}
      {userId && <PollBridge userId={userId} />}
    </>
  )
}
