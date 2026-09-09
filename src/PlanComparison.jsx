import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Crown, Gem, Sparkles, X, Zap } from 'lucide-react'
import './plan-comparison.css'

const HOST_ATTR = 'data-wavo-plan-compare-host'

const FEATURES = [
  ['Unlimited messaging, Spaces and calls', true, true, true, true],
  ['Waves, media, GIFs and reactions', true, true, true, true],
  ['Polls, plans and shared activities', true, true, true, true],
  ['One-off scheduled messages', true, true, true, true],
  ['Chat search + core safety tools', true, true, true, true],
  ['Profile Studio + custom themes', false, true, true, true],
  ['Chat themes + bubble styles', false, true, true, true],
  ['Message effects + animated reactions', false, true, true, true],
  ['Chat folders + advanced search', false, true, true, true],
  ['Recurring messages + streak protection', false, true, true, true],
  ['Wavo Labs', false, true, true, true],
  ['AI chat summaries + Ask Wavo', false, false, true, true],
  ['Voice-note transcription', false, false, true, true],
  ['Space analytics + advanced roles', false, false, false, true],
  ['Scheduled Space announcements', false, false, false, true],
]

function featureIcon(value) {
  return value ? <Check size={16} strokeWidth={3} aria-label="Included" /> : <span className="wpc-no" aria-label="Not included">—</span>
}

function readPlanMeta() {
  const cards = [...document.querySelectorAll('.wpp-plan')]
  const byName = (wanted) => cards.find((card) => card.querySelector('.wpp-plan-title strong')?.textContent?.trim().toLowerCase() === wanted)
  const premium = byName('premium')
  const plus = byName('plus')
  const pro = byName('pro')
  const current = cards.find((card) => card.classList.contains('current'))?.querySelector('.wpp-plan-title strong')?.textContent?.trim() || 'Free'
  return {
    current,
    premiumPrice: premium?.querySelector('.wpp-plan-title small')?.textContent?.trim() || 'A$4.99/month',
    plusPrice: plus?.querySelector('.wpp-plan-title small')?.textContent?.trim() || 'A$9.99/month',
    proPrice: pro?.querySelector('.wpp-plan-title small')?.textContent?.trim() || 'A$14.99/month',
  }
}

export default function PlanComparison() {
  const [host, setHost] = useState(null)
  const [open, setOpen] = useState(false)
  const [meta, setMeta] = useState(() => ({ current: 'Free', premiumPrice: 'A$4.99/month', plusPrice: 'A$9.99/month', proPrice: 'A$14.99/month' }))

  useEffect(() => {
    const sync = () => {
      const plans = document.querySelector('.wpp-plans')
      if (!plans) {
        setHost((old) => old?.isConnected ? old : null)
        return
      }
      let node = plans.parentElement?.querySelector(`[${HOST_ATTR}]`)
      if (!node) {
        node = document.createElement('div')
        node.setAttribute(HOST_ATTR, '')
        node.className = 'wpc-host'
        plans.after(node)
      }
      setHost((old) => old === node ? old : node)
      setMeta(readPlanMeta())
    }

    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    setMeta(readPlanMeta())
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const currentKey = useMemo(() => meta.current.toLowerCase(), [meta.current])
  if (!host) return null

  return <>
    {createPortal(
      <button className="wpc-trigger" type="button" onClick={() => setOpen(true)}>
        <Sparkles size={16} />
        <span>Compare plans</span>
        <small>Free vs Premium vs Plus vs Pro</small>
      </button>,
      host,
    )}

    {open && createPortal(
      <div className="wpc-backdrop" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false)
      }}>
        <section className="wpc-modal" role="dialog" aria-modal="true" aria-labelledby="wpc-title">
          <header className="wpc-modal-head">
            <div className="wpc-title-icon"><Crown size={20} /></div>
            <div>
              <span>WAVO PLANS</span>
              <h2 id="wpc-title">Pick your level</h2>
              <p>Free is already full Wavo. Paid plans add customisation, AI and power tools.</p>
            </div>
            <button className="wpc-close" type="button" aria-label="Close comparison" onClick={() => setOpen(false)}><X size={19} /></button>
          </header>

          <div className="wpc-table-wrap">
            <div className="wpc-grid wpc-plan-heads">
              <div className="wpc-feature-heading">Features</div>
              <div className={`wpc-plan-head free-plan ${currentKey === 'free' ? 'current' : ''}`}>
                <span className="wpc-plan-icon free"><Gem size={17}/></span>
                <strong>Free</strong><small>A$0 forever</small>
                {currentKey === 'free' && <em>Current</em>}
              </div>
              <div className={`wpc-plan-head premium ${currentKey === 'premium' ? 'current' : ''}`}>
                <span className="wpc-plan-icon"><Crown size={17}/></span>
                <strong>Premium</strong><small>{meta.premiumPrice}</small>
                {currentKey === 'premium' && <em>Current</em>}
              </div>
              <div className={`wpc-plan-head plus ${currentKey === 'plus' ? 'current' : ''}`}>
                <span className="wpc-plan-icon plus"><Sparkles size={17}/></span>
                <strong>Plus</strong><small>{meta.plusPrice}</small>
                {currentKey === 'plus' && <em>Current</em>}
              </div>
              <div className={`wpc-plan-head pro ${currentKey === 'pro' ? 'current' : ''}`}>
                <span className="wpc-plan-icon"><Zap size={17}/></span>
                <strong>Pro</strong><small>{meta.proPrice}</small>
                {currentKey === 'pro' && <em>Current</em>}
              </div>
            </div>

            <div className="wpc-rows">
              {FEATURES.map(([label, free, premium, plus, pro]) => <div className="wpc-grid wpc-row" key={label}>
                <div className="wpc-feature">{label}</div>
                <div className={free ? 'yes' : 'no'}>{featureIcon(free)}</div>
                <div className={premium ? 'yes' : 'no'}>{featureIcon(premium)}</div>
                <div className={plus ? 'yes' : 'no'}>{featureIcon(plus)}</div>
                <div className={pro ? 'yes' : 'no'}>{featureIcon(pro)}</div>
              </div>)}
            </div>
          </div>

          <footer className="wpc-footer">
            <span><Gem size={14}/> Free includes the full social core. Every paid tier builds on it.</span>
            <button type="button" onClick={() => setOpen(false)}>Done</button>
          </footer>
        </section>
      </div>,
      document.body,
    )}
  </>
}
