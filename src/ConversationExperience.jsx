import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, CornerDownRight, Info, Link2, Pin, Search, Send, X, PanelRightClose, PanelRightOpen, FileText, Image as ImageIcon } from 'lucide-react'
import { supabase } from './supabaseClient'
import { markDmRead } from './uxData'
import { ChatComposer, MessageContent } from './RestoredChat'
import { getDmMessages, getSpaceMessages } from './wavoData'

function useTyping(kind, targetId, userId, text) {
  const [typing, setTyping] = useState(false)
  const channelRef = useRef(null)
  const lastSentRef = useRef(0)
  const textRef = useRef('')
  const activeRef = useRef(false)
  textRef.current = text || ''

  useEffect(() => {
    if (!userId || !targetId) return undefined
    // Private realtime channels are protected by chat membership policies.
    const channel = supabase.channel(`wavo-typing:${kind}:${targetId}`, {
      config: { private: true, broadcast: { self: false } },
    })
    let clearTimer
    channel.on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (!payload || payload.userId === userId) return
      setTyping(Boolean(payload.active))
      clearTimeout(clearTimer)
      if (payload.active) clearTimer = setTimeout(() => setTyping(false), 3000)
    }).subscribe((status) => {
      if (status === 'SUBSCRIBED' && textRef.current.trim()) {
        channel.send({ type: 'broadcast', event: 'typing', payload: { userId, active: true } }).catch(() => {})
      }
    })
    channelRef.current = channel
    lastSentRef.current = 0
    activeRef.current = false
    return () => {
      clearTimeout(clearTimer)
      channel.send({ type: 'broadcast', event: 'typing', payload: { userId, active: false } }).catch(() => {})
      channelRef.current = null
      setTyping(false)
      supabase.removeChannel(channel)
    }
  }, [kind, targetId, userId])

  useEffect(() => {
    const channel = channelRef.current
    if (!channel || !userId || !targetId) return undefined
    const hasText = Boolean(text?.trim())
    const sendState = (active) => {
      if (!active && !activeRef.current) return
      if (active && Date.now() - lastSentRef.current < 1400) return
      lastSentRef.current = Date.now()
      activeRef.current = active
      channel.send({ type: 'broadcast', event: 'typing', payload: { userId, active } }).catch(() => {})
    }
    if (!hasText) { sendState(false); return undefined }
    sendState(true)
    // Typing stops automatically after inactivity, even if the composer
    // remains focused and still contains an unsent draft.
    const inactivity = setTimeout(() => sendState(false), 2200)
    return () => clearTimeout(inactivity)
  }, [text, userId, targetId])

  return typing
}

function safeLinks(content) {
  return (String(content || '').match(/https?:\/\/[^\s<>"']+/ig) || []).filter((url) => {
    try { return ['http:', 'https:'].includes(new URL(url).protocol) } catch { return false }
  })
}
function formatDate(ts) {
  return ts ? new Date(ts).toLocaleString() : ''
}

function InfoPanel({ name, messages, pins, onClose, onJump, onUnpin }) {
  const [tab, setTab] = useState('pinned')
  const [search, setSearch] = useState('')
  const pinned = messages.filter((m) => pins.has(m.id))
  const files = messages.filter((m) => m.type === 'file')
  const media = messages.filter((m) => m.type === 'image')
  const links = messages.flatMap((m) => safeLinks(m.content).map((href) => ({ href, id: m.id })))
  const hits = messages.filter((m) => String(m.content || '').toLowerCase().includes(search.trim().toLowerCase()))
  return <aside className="wavo-info-panel" role="dialog" aria-label={`Conversation information for ${name}`}>
    <header><strong>{name} details</strong><button type="button" onClick={onClose} aria-label="Close chat details"><X size={18}/></button></header>
    <nav aria-label="Chat information sections">
      {['pinned', 'media', 'files', 'links', 'search'].map((section) =>
        <button key={section} type="button" className={tab === section ? 'selected' : ''} onClick={() => setTab(section)}>{section}</button>)}
    </nav>
    <div className="wavo-info-results">
      {tab === 'pinned' && (pinned.length
        ? pinned.map((m) => <div key={m.id} className="wavo-info-result"><button onClick={() => onJump(m.id)}>{String(m.content || 'Attachment').slice(0, 160)}</button><button title="Unpin" onClick={() => onUnpin(m.id)}><X size={14}/></button></div>)
        : <p>No pinned messages yet. Pin one from its message actions.</p>)}
      {tab === 'media' && (media.length
        ? media.map((m) => <button key={m.id} className="wavo-info-media" onClick={() => onJump(m.id)}><img src={m.content} alt="Shared image" loading="lazy"/></button>)
        : <p>No shared images yet.</p>)}
      {tab === 'files' && (files.length
        ? files.map((m) => <a key={m.id} href={m.content} rel="noopener noreferrer" target="_blank"><FileText size={15}/>{m.file_name || 'Attachment'}</a>)
        : <p>No shared files yet.</p>)}
      {tab === 'links' && (links.length
        ? links.map(({ href, id }, n) => <a key={id + ':' + n} href={href} target="_blank" rel="noopener noreferrer"><Link2 size={15}/>{href.slice(0, 85)}</a>)
        : <p>No shared links yet.</p>)}
      {tab === 'search' && <>
        <label className="wavo-info-search"><Search size={16}/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find in conversation" autoFocus /></label>
        {search.trim() ? hits.slice(-70).reverse().map((m) => <button key={m.id} onClick={() => onJump(m.id)}>{String(m.content || '').slice(0, 150)}<small>{formatDate(m.created_at)}</small></button>) : <p>Search messages in this conversation.</p>}
        {search.trim() && !hits.length && <p>No matching messages.</p>}
      </>}
    </div>
  </aside>
}

function ThreadPanel({ parent, replies, onClose, onReply }) {
  return <aside className="wavo-thread-panel" role="dialog" aria-label="Message thread">
    <header><strong>Thread · {replies.length} {replies.length === 1 ? 'reply' : 'replies'}</strong><button type="button" onClick={onClose} aria-label="Close thread"><X size={18}/></button></header>
    {[parent, ...replies].map((message) => <div key={message.id} className="wavo-thread-item">
      <small>{message.sender?.username || formatDate(message.created_at)}</small>
      <MessageContent message={message} />
    </div>)}
    <button type="button" className="wavo-thread-reply" onClick={onReply}><CornerDownRight size={16}/> Reply in conversation</button>
  </aside>
}

function RailControls({ kind, targetId }) {
  const [width, setWidth] = useState(() => {
    try { return Math.max(248, Math.min(420, Number(localStorage.getItem('wavo:chat-rail-width')) || 300)) } catch { return 300 }
  })
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('wavo:chat-rail-collapsed') === '1' } catch { return false }
  })
  const ref = useRef(null)
  useEffect(() => {
    const root = ref.current?.closest(kind === 'dm' ? '.chat-screen' : '.space-chat-card')
    if (!root) return
    root.style.setProperty('--wavo-desktop-chat-rail', `${width}px`)
    root.dataset.wavoRailCollapsed = collapsed ? 'true' : 'false'
  }, [kind, width, collapsed, targetId])
  const startResize = (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    const root = ref.current?.closest(kind === 'dm' ? '.chat-screen' : '.space-chat-card')
    if (!root) return
    const onMove = (e) => {
      const bounds = root.getBoundingClientRect()
      const proposed = Math.min(420, Math.max(248, bounds.right - e.clientX))
      const next = Math.min(proposed, Math.max(248, bounds.width - 420))
      setWidth(next)
      try { localStorage.setItem('wavo:chat-rail-width', String(next)) } catch {}
    }
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp) }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    window.addEventListener('pointercancel', onUp, { once: true })
  }
  return <div ref={ref} className="wavo-rail-ui">
    {!collapsed && <div className="wavo-rail-grip" role="separator" aria-orientation="vertical" aria-label="Resize Premium tools sidebar" title="Drag to resize" onPointerDown={startResize}/>}
    <button type="button" className="wavo-rail-toggle" onClick={() => { setCollapsed(!collapsed); try { localStorage.setItem('wavo:chat-rail-collapsed', collapsed ? '0' : '1') } catch {} }} title={collapsed ? 'Show chat tools' : 'Hide chat tools'} aria-label={collapsed ? 'Show chat tools' : 'Hide chat tools'}>
      {collapsed ? <PanelRightOpen size={17}/> : <PanelRightClose size={17}/>}
    </button>
  </div>
}

function MessageRow({ message, kind, mine, parent, childrenCount, pins, onReply, onThread, onPin, lastOutgoing, actionsOpen, toggleActions }) {
  return <div id={`wavo-msg-${message.id}`} className={kind === 'dm' ? (mine ? 'dm-row mine' : 'dm-row') : (mine ? 'space-message mine' : 'space-message')}>
    {kind === 'space' && <span className="wavo-message-sender">{message.sender?.username || (mine ? 'You' : 'Member')}</span>}
    <div className={kind === 'dm' ? 'dm-bubble' : 'wavo-space-bubble'}>
      {parent && <button type="button" className="wavo-reply-quote" onClick={() => document.getElementById(`wavo-msg-${parent.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })}><CornerDownRight size={13}/>{String(parent.content || 'Attachment').slice(0, 90)}</button>}
      <MessageContent message={message} mine={mine}/>
      <div className="wavo-message-meta">
        <span>{formatDate(message.created_at)}</span>
        {message.queued && <span>Queued offline</span>}
        {kind === 'dm' && mine && lastOutgoing && <span>{message.is_read ? 'Seen' : 'Sent'}</span>}
      </div>
    </div>
    {!message.deleted_at && !message.queued && <div className={`wavo-message-actions ${actionsOpen ? 'expanded' : ''}`}>
      <button type="button" className="wavo-message-more" aria-label={actionsOpen ? 'Hide message actions' : 'Message actions'} aria-expanded={actionsOpen} onClick={toggleActions}>•••</button>
      <div className="wavo-message-action-buttons">
        <button type="button" onClick={() => onReply(message)} title="Reply"><CornerDownRight size={15}/> Reply</button>
        <button type="button" onClick={() => onThread(message)} title="View thread">Thread{childrenCount ? ` (${childrenCount})` : ''}</button>
        <button type="button" onClick={() => onPin(message.id)} title={pins.has(message.id) ? 'Unpin message' : 'Pin message'}><Pin size={14} />{pins.has(message.id) ? 'Unpin' : 'Pin'}</button>
      </div>
    </div>}
  </div>
}

export default function ConversationExperience({ kind, friend, space, userId, messages, messageText, setMessageText, sendMessage, sending = false, onBack, onTools, name, Avatar }) {
  const target = friend || space
  const targetId = target?.id
  const chatId = kind === 'dm' ? [userId, targetId].sort().join('_') : String(targetId)
  const [reply, setReply] = useState(null)
  const [thread, setThread] = useState(null)
  const [info, setInfo] = useState(false)
  const [pins, setPins] = useState(new Set())
  const [dragging, setDragging] = useState(false)
  const [notice, setNotice] = useState('')
  const [actionsMessageId, setActionsMessageId] = useState(null)
  const [olderMessages, setOlderMessages] = useState([])
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [noMoreHistory, setNoMoreHistory] = useState(false)
  const dragDepth = useRef(0)
  const messageListRef = useRef(null)
  const currentChatRef = useRef('')
  currentChatRef.current = `${kind}:${targetId}` 
  const displayMessages = useMemo(() => {
    const unique = new Map()
    for (const message of olderMessages) unique.set(message.id, message)
    for (const message of messages) unique.set(message.id, message)
    return [...unique.values()].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  }, [olderMessages, messages])
  const typing = useTyping(kind, chatId, userId, messageText)
  // A conversation with hundreds of messages should not scan the entire
  // history separately for every message on every keystroke.
  const { byId, replyCounts, lastOutgoing } = useMemo(() => {
    const byId = new Map()
    const replyCounts = new Map()
    let lastOutgoing
    for (const m of displayMessages) {
      byId.set(m.id, m)
      if (m.reply_to) replyCounts.set(m.reply_to, (replyCounts.get(m.reply_to) || 0) + 1)
      if (m.sender_id === userId || (kind === 'space' && m.user_id === userId)) lastOutgoing = m.id
    }
    return { byId, replyCounts, lastOutgoing }
  }, [displayMessages, userId, kind])
  useEffect(() => {
    setOlderMessages([])
    setNoMoreHistory(false)
    setLoadingOlder(false)
    window.dispatchEvent(new Event('wavo:conversation-change'))
  }, [kind, targetId])

  const loadPins = useCallback(async () => {
    if (!userId || !targetId) return
    const { data, error } = await supabase.from('chat_message_pins').select('message_id').eq('user_id', userId).eq('kind', kind).eq('target_id', String(targetId))
    if (!error) setPins(new Set((data || []).map((row) => row.message_id)))
  }, [userId, targetId, kind])
  useEffect(() => { setReply(null); setThread(null); setInfo(false); setActionsMessageId(null); loadPins() }, [loadPins])

  useEffect(() => {
    if (kind !== 'dm' || !userId || !targetId || !messages.some((m) => m.receiver_id === userId && !m.is_read)) return
    const mark = () => { if (document.visibilityState === 'visible') markDmRead(userId, targetId).catch(() => {}) }
    mark()
    document.addEventListener('visibilitychange', mark)
    return () => document.removeEventListener('visibilitychange', mark)
  }, [kind, userId, targetId, messages])

  async function togglePin(messageId) {
    if (!userId || !targetId) return
    const isPinned = pins.has(messageId)
    const query = supabase.from('chat_message_pins')
    const { error } = isPinned
      ? await query.delete().eq('user_id', userId).eq('kind', kind).eq('target_id', String(targetId)).eq('message_id', messageId)
      : await query.insert({ user_id: userId, kind, target_id: String(targetId), message_id: messageId })
    if (error) { setNotice('Could not update pin. Please try again.'); return }
    setPins((current) => {
      const next = new Set(current)
      if (isPinned) next.delete(messageId)
      else next.add(messageId)
      return next
    })
  }

  async function loadEarlier() {
    if (loadingOlder || noMoreHistory || !displayMessages.length) return
    const cursor = displayMessages[0]?.created_at
    if (!cursor) return
    const chatKey = currentChatRef.current
    const viewport = messageListRef.current
    const previousHeight = viewport?.scrollHeight || 0
    const previousTop = viewport?.scrollTop || 0
    setLoadingOlder(true)
    try {
      const rows = kind === 'dm'
        ? (await getDmMessages(userId, targetId, cursor)).messages
        : await getSpaceMessages(targetId, cursor)
      if (currentChatRef.current !== chatKey) return
      setOlderMessages((current) => {
        const combined = new Map([...rows, ...current].map((row) => [row.id, row]))
        return [...combined.values()].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      })
      if (rows.length < (kind === 'dm' ? 500 : 300)) setNoMoreHistory(true)
      requestAnimationFrame(() => {
        const element = messageListRef.current
        if (element && currentChatRef.current === chatKey) {
          element.scrollTop = previousTop + element.scrollHeight - previousHeight
        }
      })
    } catch (error) {
      console.warn('[wavo] history pagination unavailable', error)
      setNotice("Couldn't load older messages. Please try again.")
    } finally {
      if (currentChatRef.current === chatKey) setLoadingOlder(false)
    }
  }

  const drop = (event) => {
    event.preventDefault()
    event.stopPropagation()
    dragDepth.current = 0
    setDragging(false)
    const files = Array.from(event.dataTransfer?.files || [])
    if (!files.length) return
    window.dispatchEvent(new CustomEvent('wavo:chat-drop', { detail: { kind, targetId, files } }))
  }
  const enter = (event) => {
    if (!event.dataTransfer?.types?.includes('Files')) return
    event.preventDefault()
    dragDepth.current++
    setDragging(true)
  }
  const leave = (event) => {
    event.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (!dragDepth.current) setDragging(false)
  }
  const jump = (id) => {
    setInfo(false)
    document.getElementById(`wavo-msg-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  const submit = async (event) => {
    const completed = await sendMessage(event, reply?.id || null)
    if (completed) setReply(null)
  }
  const openThread = (message) => setThread(message.reply_to ? byId.get(message.reply_to) || message : message)
  const nameLabel = name || target?.username || target?.name || 'Conversation'

  return <div className={kind === 'dm' ? 'chat-screen' : 'space-chat-card'} onDragEnter={enter} onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault() }} onDragLeave={leave} onDrop={drop}>
    {kind === 'dm'
      ? <header className="chat-topbar"><button className="chat-back-button" onClick={onBack} aria-label="Back to Inbox"><ChevronLeft size={20}/><span>Inbox</span></button><Avatar profile={friend} size="sm"/><div><strong>{nameLabel}</strong><span>{friend?.status || 'Wavo friend'}</span></div><button className="wavo-chat-info-button" type="button" onClick={() => setInfo(!info)} aria-label="Conversation information"><Info size={18}/></button><button className="mobile-tools-button" onClick={onTools} aria-label="Chat tools">•••</button></header>
      : <div className="section-heading"><div><span className="eyebrow">PERSISTENT CHAT</span><h2>Conversation</h2></div><button className="wavo-chat-info-button" type="button" onClick={() => setInfo(!info)} aria-label="Space conversation information"><Info size={18}/></button></div>}
    <div ref={messageListRef} className={kind === 'dm' ? 'dm-messages' : 'space-messages'}>
      {messages.length >= (kind === 'dm' ? 500 : 300) && !noMoreHistory &&
        <button type="button" className="wavo-load-older" disabled={loadingOlder} onClick={loadEarlier}>
          {loadingOlder ? 'Loading older messages…' : 'Load older messages'}
        </button>}
      {kind === 'space' && displayMessages.length === 0 && <div className="muted center">Start the conversation.</div>}
      {displayMessages.map((m) => <MessageRow key={m.id} kind={kind} message={m} parent={byId.get(m.reply_to)} childrenCount={replyCounts.get(m.id) || 0} mine={m.sender_id === userId || (kind === 'space' && m.user_id === userId)} pins={pins} onReply={(message) => { setReply(message.reply_to ? byId.get(message.reply_to) || message : message); setActionsMessageId(null) }} onThread={(message) => { openThread(message); setActionsMessageId(null) }} onPin={(id) => { togglePin(id); setActionsMessageId(null) }} lastOutgoing={m.id === lastOutgoing} actionsOpen={actionsMessageId === m.id} toggleActions={() => setActionsMessageId((current) => current === m.id ? null : m.id)} />)}
      {typing && <div className="wavo-typing" role="status">{kind === 'dm' ? `${friend?.username || 'Someone'} is typing…` : 'Someone is typing…'}</div>}
    </div>
    <ChatComposer key={chatId} userId={userId} friend={friend} space={space} value={messageText} onChange={setMessageText} onSubmit={submit} sending={sending} replyTo={reply} onCancelReply={() => setReply(null)}/>
    <RailControls kind={kind} targetId={targetId}/>
    {notice && <button type="button" className="wavo-workspace-notice" onClick={() => setNotice('')}>{notice}</button>}
    {info && <InfoPanel name={nameLabel} messages={displayMessages} pins={pins} onClose={() => setInfo(false)} onJump={jump} onUnpin={togglePin}/>}
    {thread && <ThreadPanel parent={thread} replies={displayMessages.filter((m) => m.reply_to === thread.id)} onClose={() => setThread(null)} onReply={() => { setReply(thread); setThread(null) }}/>}
    {dragging && <div className="wavo-drop-overlay">Drop files to preview and send</div>}
  </div>
}
