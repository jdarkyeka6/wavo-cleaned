import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bot, Check, Mic2, Sparkles } from 'lucide-react'
import { supabase } from './supabaseClient'
import { proAi } from './premiumProData'
import { APPLE_PRODUCTS, isNativeIOS, loadStoreProducts, purchaseAppleTier, startWebCheckout } from './storePurchases'
import './plus-plan.css'

const PLAN_HOST = 'data-wavo-plus-plan-host'
const AI_HOST = 'data-wavo-plus-ai-host'

function active(profile) {
  return Boolean(profile?.is_premium) && (!profile?.premium_until || new Date(profile.premium_until) > new Date())
}

function effectiveTier(profile) {
  if (!active(profile)) return 'free'
  const tier = String(profile?.tier || 'premium').toLowerCase()
  const source = String(profile?.entitlement_source || '').toLowerCase()
  if (source === 'stripe_plus' && !['pro', 'vip'].includes(tier)) return 'plus'
  return tier === 'vip' ? 'pro' : tier
}

function resolveCurrentChat() {
  const dm = document.querySelector('.chat-screen')
  if (dm) {
    const canonical = [...dm.querySelectorAll('.chat-topbar span')]
      .map((node) => node.textContent?.trim() || '')
      .find((value) => value.startsWith('@'))
    const username = (canonical ? canonical.slice(1) : dm.querySelector('.chat-topbar strong')?.textContent?.trim()) || ''
    return username ? { kind: 'dm', username, root: dm } : null
  }
  const space = document.querySelector('.space-chat-card')
  if (space) {
    const name = document.querySelector('.space-hero h1')?.textContent?.trim() || ''
    return name ? { kind: 'space', name, root: space } : null
  }
  return null
}

export default function PlusPlanEnhancement() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [planHost, setPlanHost] = useState(null)
  const [aiHost, setAiHost] = useState(null)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [messages, setMessages] = useState([])
  const [transcripts, setTranscripts] = useState({})
  const [products, setProducts] = useState([])

  const userId = session?.user?.id || null
  const tier = effectiveTier(profile)
  const plus = tier === 'plus'
  const pro = tier === 'pro'
  const aiEntitled = plus || pro
  const native = isNativeIOS()
  const plusProduct = products.find((item) => item.identifier === APPLE_PRODUCTS.plus)
  const plusPrice = native
    ? (plusProduct?.priceString ? `${plusProduct.priceString}/month` : 'Loading from App Store…')
    : 'A$9.99/month'

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(({ data }) => { if (alive) setSession(data.session || null) })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => { if (alive) setSession(next || null) })
    return () => { alive = false; data.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (!native) return
    loadStoreProducts().then(setProducts).catch(() => setProducts([]))
  }, [native])

  useEffect(() => {
    if (!userId) { setProfile(null); return }
    const load = () => supabase.from('profiles').select('id,is_premium,premium_until,tier,entitlement_source').eq('id', userId).maybeSingle().then(({ data }) => setProfile(data || null))
    load()
    const channel = supabase.channel(`wavo-plus-${userId}`).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` }, load).subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userId])

  useEffect(() => {
    const sync = () => {
      const plans = document.querySelector('.wpp-plans')
      if (plans) {
        let host = plans.querySelector(`[${PLAN_HOST}]`)
        if (!host) {
          host = document.createElement('div')
          host.setAttribute(PLAN_HOST, '')
          host.className = 'wavo-plus-plan-host'
          const first = plans.querySelector('.wpp-plan')
          if (first?.nextSibling) plans.insertBefore(host, first.nextSibling)
          else plans.appendChild(host)
        }
        setPlanHost(host)
      } else setPlanHost(null)

      const chat = resolveCurrentChat()
      const composer = chat?.root?.querySelector('.composer')
      if (chat?.root && composer) {
        let host = chat.root.querySelector(`[${AI_HOST}]`)
        if (!host) {
          host = document.createElement('div')
          host.setAttribute(AI_HOST, '')
          host.className = 'wavo-plus-ai-host'
          composer.before(host)
        }
        setAiHost(host)
      } else setAiHost(null)

      const proCard = [...document.querySelectorAll('.wpp-plan')].find((card) => card.querySelector('.wpp-plan-title strong')?.textContent?.trim().toLowerCase() === 'pro')
      if (proCard) proCard.classList.add('wavo-most-features')
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!aiEntitled || !userId || !aiHost) { setMessages([]); return }
    let cancelled = false
    async function load() {
      const chat = resolveCurrentChat()
      if (!chat) return
      if (chat.kind === 'dm') {
        const { data: friend } = await supabase.from('profiles').select('id,username').ilike('username', chat.username).limit(1).maybeSingle()
        if (!friend?.id || cancelled) return
        const chatId = [userId, friend.id].sort().join('_')
        const { data } = await supabase.from('messages').select('id,sender_id,content,type,file_url,created_at').eq('chat_id', chatId).order('created_at', { ascending: true }).limit(160)
        if (!cancelled) setMessages(data || [])
      } else {
        const { data: group } = await supabase.from('groups').select('id').eq('name', chat.name).limit(1).maybeSingle()
        if (!group?.id || cancelled) return
        const { data } = await supabase.from('group_messages').select('id,sender_id,user_id,content,type,file_url,created_at').eq('group_id', group.id).order('created_at', { ascending: true }).limit(160)
        if (!cancelled) setMessages(data || [])
      }
    }
    load()
    const timer = setInterval(load, 5000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [aiEntitled, userId, aiHost])

  const context = useMemo(() => messages.map((m) => `${String(m.sender_id || m.user_id) === String(userId) ? 'You' : 'Member'}: ${m.content || `[${m.type || 'message'}]`}`).join('\n'), [messages, userId])
  const audio = useMemo(() => messages.filter((m) => m.type === 'audio' && (m.file_url || m.content)).slice(-4).reverse(), [messages])

  async function refreshProfile() {
    if (!userId) return
    const { data } = await supabase.from('profiles').select('id,is_premium,premium_until,tier,entitlement_source').eq('id', userId).maybeSingle()
    setProfile(data || null)
  }

  async function buyPlus() {
    if (pro) return
    setBusy('buy'); setNotice('')
    try {
      if (native) {
        if (!plusProduct) throw new Error('Plus is still loading from the App Store. Try again in a moment.')
        await purchaseAppleTier('plus', userId)
      } else {
        await startWebCheckout('plus')
      }
      await refreshProfile()
      setNotice('Wavo Plus is active.')
    } catch (error) { setNotice(error?.message || 'Could not start Plus purchase.') }
    setBusy('')
  }

  async function runAi(action) {
    if (!aiEntitled || !context.trim()) return
    setBusy(action); setAnswer('')
    try {
      const result = await proAi(action, { context, question })
      setAnswer(result?.reply || 'No answer returned.')
    } catch (error) { setAnswer(error?.message || 'Wavo AI could not answer.') }
    setBusy('')
  }

  async function transcribe(message) {
    if (!aiEntitled) return
    const audioUrl = message.file_url || message.content
    if (!audioUrl) return
    setTranscripts((old) => ({ ...old, [message.id]: 'Transcribing…' }))
    try {
      const result = await proAi('transcribe', { audioUrl })
      setTranscripts((old) => ({ ...old, [message.id]: result?.transcript || 'No speech detected.' }))
    } catch (error) {
      setTranscripts((old) => ({ ...old, [message.id]: error?.message || 'Transcription failed.' }))
    }
  }

  return <>
    {planHost && createPortal(
      <article className={`wpp-plan wavo-plus-card ${plus ? 'current' : ''}`}>
        <span className="wavo-plan-badge recommended">Recommended</span>
        <div className="wpp-plan-title"><span><Sparkles size={18}/></span><div><strong>Plus</strong><small>{plusPrice}</small></div>{plus && <em>Current</em>}</div>
        <div className="wpp-feature-list">
          {['Everything in Premium', 'AI chat summaries + Ask Wavo', 'Voice-note transcription'].map((feature) => <span key={feature}><Check size={14}/>{feature}</span>)}
        </div>
        {pro
          ? <div className="wpp-plan-included">Included with Pro</div>
          : !plus && <button type="button" disabled={busy === 'buy'} onClick={buyPlus}>{busy === 'buy' ? (native ? 'Purchasing…' : 'Opening…') : tier === 'premium' ? 'Upgrade to Plus' : 'Get Plus'}</button>}
        {notice && <small className="wavo-plus-notice">{notice}</small>}
      </article>,
      planHost,
    )}

    {aiEntitled && aiHost && createPortal(
      <section className="wavo-plus-ai-panel">
        <div className="wavo-plus-ai-title"><Bot size={16}/><strong>Wavo AI</strong><span>{pro ? 'PRO' : 'PLUS'}</span></div>
        <div className="wavo-plus-ai-actions">
          <button disabled={busy || !messages.length} onClick={() => runAi('summary')}>{busy === 'summary' ? 'Thinking…' : 'Summarise this chat'}</button>
          <div><input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about this conversation"/><button disabled={busy || !question.trim()} onClick={() => runAi('ask')}>Ask Wavo</button></div>
        </div>
        {answer && <p className="wavo-plus-ai-answer">{answer}</p>}
        {audio.length > 0 && <div className="wavo-plus-audio"><strong><Mic2 size={14}/> Voice transcription</strong>{audio.map((message) => <div key={message.id}><button onClick={() => transcribe(message)}>Transcribe voice note</button>{transcripts[message.id] && <p>{transcripts[message.id]}</p>}</div>)}</div>}
      </section>,
      aiHost,
    )}
  </>
}
