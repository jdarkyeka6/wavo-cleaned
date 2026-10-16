import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, MessageCircle, Users, Home, User, Command, CornerDownLeft } from 'lucide-react'

export default function CommandPalette({ friends, spaces, onFriend, onSpace, onTab }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const field = useRef(null)
  useEffect(() => {
    const shortcut = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((previous) => !previous)
        setQuery('')
        setSelected(0)
      } else if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [])
  useEffect(() => { if (open) field.current?.focus() }, [open])
  const rows = useMemo(() => [
    ...[{ id: 'home', name: 'Home', icon: Home }, { id: 'inbox', name: 'Inbox', icon: MessageCircle }, { id: 'spaces', name: 'Spaces', icon: Users }, { id: 'you', name: 'Profile', icon: User }].map((entry) => ({ ...entry, kind: 'page' })),
    ...(friends || []).map((person) => ({ kind: 'friend', id: person.id, name: person.username || 'Friend', person, icon: MessageCircle })),
    ...(spaces || []).map((space) => ({ kind: 'space', id: space.id, name: space.name || 'Space', space, icon: Users })),
  ].filter((entry) => entry.name.toLowerCase().includes(query.toLowerCase().trim())).slice(0, 35), [friends, spaces, query])
  const choose = (item) => {
    if (!item) return
    if (item.kind === 'friend') onFriend(item.person)
    else if (item.kind === 'space') onSpace(item.space)
    else onTab(item.id)
    setOpen(false)
    setQuery('')
  }
  useEffect(() => setSelected(0), [query])
  return <>
    <button type="button" className="wavo-command-trigger" onClick={() => setOpen(true)} aria-label="Open quick search (Control K)"><Search size={17}/><span>Jump to…</span><kbd>Ctrl K</kbd></button>
    {open && <div className="wavo-command-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}>
      <div className="wavo-command-dialog" role="dialog" aria-modal="true" aria-label="Quick navigation">
        <label><Command size={18}/><input ref={field} placeholder="Search chats, Spaces, pages…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((n) => Math.min(rows.length - 1, n + 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((n) => Math.max(0, n - 1)) }
          if (e.key === 'Enter') { e.preventDefault(); choose(rows[selected]) }
        }}/><kbd>ESC</kbd></label>
        <div className="wavo-command-results">
          {rows.map((item, index) => <button type="button" key={item.kind + item.id} className={index === selected ? 'active' : ''} onMouseEnter={() => setSelected(index)} onClick={() => choose(item)}><item.icon size={17}/><span><strong>{item.name}</strong><small>{item.kind === 'friend' ? 'Direct message' : item.kind === 'space' ? 'Space' : 'Page'}</small></span>{index === selected && <CornerDownLeft size={15}/>}</button>)}
          {!rows.length && <p>No matching chats or Spaces</p>}
        </div>
        <footer>↑ ↓ Navigate · Enter Open · Esc Close</footer>
      </div>
    </div>}
  </>
}
