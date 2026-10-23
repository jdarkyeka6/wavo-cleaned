import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Clock3, RefreshCw, Trash2, X } from 'lucide-react'
import { getOutbox, removeOutboxItem } from './offline'
import './outbox-tray.css'

export default function OutboxTray({ userId, online }) {
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const sync = () => setItems(userId ? getOutbox(userId) : [])
    sync()
    window.addEventListener('wavo:outbox-changed', sync)
    window.addEventListener('storage', sync)
    return () => { window.removeEventListener('wavo:outbox-changed', sync); window.removeEventListener('storage', sync) }
  }, [userId])
  useEffect(() => { if (items.length === 0) setOpen(false) }, [items.length])
  if (!userId || items.length === 0) return null
  const blocked = items.filter((item) => item.status === 'blocked').length
  return <>
    <button type="button" className="wavo-outbox-chip" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={`Outbox, ${items.length} pending message(s)`}>
      <Clock3 size={15}/><span>Outbox {items.length}</span>{blocked > 0 && <AlertCircle size={14}/>}
    </button>
    {open && <div className="wavo-outbox-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}>
      <div className="wavo-outbox-panel" role="dialog" aria-modal="true" aria-label="Offline outbox">
        <header><div><strong>Messages waiting to send</strong><small>{blocked ? `${blocked} need attention · ` : ''}${items.length} in Outbox</small></div><button onClick={() => setOpen(false)} aria-label="Close Outbox"><X size={18}/></button></header>
        <div className="wavo-outbox-list">
          {items.map((item) => <div className="wavo-outbox-item" key={item.id}>
            <div className="wavo-outbox-item-heading"><strong>{item.kind === 'dm' ? 'Direct message' : 'Space message'}</strong><small>{new Date(item.queuedAt).toLocaleString()}</small></div>
            <p>{item.content}</p>
            <footer><span>{item.status === 'blocked' ? 'Needs review before sending' : online ? 'Waiting to retry' : 'Saved on this device'}</span><button aria-label="Remove unsent message" type="button" onClick={() => removeOutboxItem(userId, item.id)}><Trash2 size={14}/> Discard</button></footer>
          </div>)}
        </div>
        <div className="wavo-outbox-bottom">
          <small>Queued messages stay on this device until sent or discarded. Nothing is sent without passing safety checks.</small>
          <button type="button" disabled={!online || items.every((item) => item.status === 'blocked')} onClick={() => window.dispatchEvent(new Event('wavo:outbox-retry'))}><RefreshCw size={15}/> Retry now</button>
        </div>
      </div>
    </div>}
  </>
}
