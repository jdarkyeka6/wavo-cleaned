import { useEffect, useMemo, useState } from "react";
import { Search, WifiOff, X, Pin, Clock3, Image as ImageIcon, CalendarClock, UserRoundPen, BellOff, Sparkles, ChevronRight } from "lucide-react";
import { getUxPrefs, updateUxPrefs } from "./offline";

function norm(v) { return String(v || "").toLowerCase(); }

export function OfflineBanner({ online, queued = 0 }) {
  if (online) return null;
  return <div className="offline-banner"><WifiOff size={16} /><span>Offline. Recent Wavo content still works{queued ? ` · ${queued} queued` : ""}.</span></div>;
}

export function Onboarding({ userId, onCreateSpace, onAddFriend }) {
  const key = `wavo:onboarding:v2:${userId}`;
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(key) !== "done"; } catch { return false; } });
  if (!open) return null;
  const done = () => { try { localStorage.setItem(key, "done"); } catch { console.info("[wavo] onboarding state could not be persisted"); } setOpen(false); };
  return <div className="ux-overlay"><section className="ux-sheet onboarding-sheet">
    <button className="sheet-close" onClick={done}><X /></button>
    <div className="wavo-mark">W</div><span className="eyebrow">WELCOME TO WAVO</span><h2>Your people, without the clutter.</h2>
    <div className="onboarding-steps">
      <button onClick={() => { done(); onAddFriend(); }}><b>1</b><div><strong>Add your people</strong><span>Only people you add become part of your Wavo.</span></div><ChevronRight /></button>
      <button onClick={() => { done(); onCreateSpace(); }}><b>2</b><div><strong>Make a Space</strong><span>Plans, polls, activities and chat live together.</span></div><ChevronRight /></button>
      <div><b>3</b><div><strong>Actually do something</strong><span>Turn conversation into a plan, then keep the memory.</span></div></div>
    </div><button className="primary-btn" onClick={done}>Got it</button>
  </section></div>;
}

export function UniversalSearch({ open, onClose, data, messages = [], onOpenFriend, onOpenSpace, onOpenTab }) {
  const [query, setQuery] = useState("");
  useEffect(() => { if (open) setQuery(""); }, [open]);
  useEffect(() => {
    function keys(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); open ? onClose() : null; }
      if (e.key === "Escape" && open) onClose();
    }
    window.addEventListener("keydown", keys); return () => window.removeEventListener("keydown", keys);
  }, [open, onClose]);
  const results = useMemo(() => {
    const q = norm(query).trim(); if (q.length < 1) return [];
    const out = [];
    (data.friends || []).forEach((x) => { if (norm(x.username).includes(q) || norm(x.status).includes(q)) out.push({ kind:"friend", id:x.id, title:x.username, sub:x.status || "Friend", item:x }); });
    (data.spaces || []).forEach((x) => { if (norm(x.name).includes(q) || norm(x.description).includes(q)) out.push({ kind:"space", id:x.id, title:x.name, sub:"Space", item:x }); });
    (data.plans || []).forEach((x) => { if (norm(x.title).includes(q) || norm(x.location).includes(q)) out.push({ kind:"plan", id:x.id, title:x.title, sub:x.location || "Plan" }); });
    (data.posts || []).forEach((x) => { if (norm(x.body).includes(q)) out.push({ kind:"post", id:x.id, title:x.author?.username || "Post", sub:x.body }); });
    (data.waves || []).forEach((x) => { if (norm(x.body).includes(q)) out.push({ kind:"wave", id:x.id, title:x.author?.username || "Wave", sub:x.body }); });
    (messages || []).forEach((x) => { if (norm(x.content).includes(q)) out.push({ kind:"message", id:x.id, title:"Message", sub:x.content }); });
    return out.slice(0, 40);
  }, [query, data, messages]);
  if (!open) return null;
  const choose = (r) => { if (r.kind === "friend") onOpenFriend(r.item); else if (r.kind === "space") onOpenSpace(r.item); else onOpenTab("home"); onClose(); };
  return <div className="ux-overlay search-overlay"><section className="ux-sheet search-sheet">
    <div className="search-box"><Search /><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search Wavo"/><button onClick={onClose}><X /></button></div>
    {!query && <div className="search-empty"><Search/><strong>Find anything</strong><span>People, Spaces, messages, plans, posts and Waves.</span><kbd>⌘/Ctrl K</kbd></div>}
    <div className="search-results">{results.map((r) => <button key={`${r.kind}:${r.id}`} onClick={() => choose(r)}><span className="result-kind">{r.kind}</span><div><strong>{r.title}</strong><span>{r.sub}</span></div><ChevronRight /></button>)}</div>
  </section></div>;
}

export function CatchUpCard({ requests = [], plans = [], polls = [], userId }) {
  const upcoming = plans.filter((p) => new Date(p.starts_at) > new Date()).slice(0, 2);
  const unvoted = polls.filter((p) => !(p.votes || []).some((v) => v.user_id === userId)).slice(0, 2);
  if (!requests.length && !upcoming.length && !unvoted.length) return null;
  return <section className="catchup-card"><div><span className="eyebrow">CATCH UP</span><h2>What needs you</h2></div><div className="catchup-items">
    {requests.length > 0 && <span><b>{requests.length}</b> friend request{requests.length === 1 ? "" : "s"}</span>}
    {unvoted.length > 0 && <span><b>{unvoted.length}</b> poll{unvoted.length === 1 ? "" : "s"} waiting for your vote</span>}
    {upcoming.length > 0 && <span><b>{upcoming.length}</b> upcoming plan{upcoming.length === 1 ? "" : "s"}</span>}
  </div></section>;
}

export function QuickAccess({ userId, friends, spaces, pins = [], onFriend, onSpace }) {
  const prefs = getUxPrefs(userId);
  const pinnedFriends = pins.filter((p) => p.kind === "dm").map((p) => p.target_id);
  const pinnedSpaces = pins.filter((p) => p.kind === "space").map((p) => p.target_id);
  const friendIds = [...new Set([...pinnedFriends, ...(prefs.recentFriends || [])])].slice(0, 4);
  const spaceIds = [...new Set([...pinnedSpaces, ...(prefs.recentSpaces || [])])].slice(0, 4);
  const items = [
    ...friendIds.map((id) => ({ kind:"friend", item: friends.find((f) => f.id === id), pinned:pinnedFriends.includes(id) })),
    ...spaceIds.map((id) => ({ kind:"space", item: spaces.find((s) => s.id === id), pinned:pinnedSpaces.includes(id) })),
  ].filter((x) => x.item).slice(0, 6);
  if (!items.length) return null;
  return <section className="quick-access"><span className="eyebrow">QUICK ACCESS</span><div>{items.map((x) => <button key={`${x.kind}:${x.item.id}`} onClick={() => x.kind === "friend" ? onFriend(x.item) : onSpace(x.item)}>{x.pinned && <Pin size={12}/>}<strong>{x.kind === "friend" ? x.item.username : `${x.item.emoji || "🌊"} ${x.item.name}`}</strong><span>{x.kind === "friend" ? "Message" : "Space"}</span></button>)}</div></section>;
}

export function ChatTools({ open, onClose, target, kind, messages, pinned, nickname, onTogglePin, onNickname, onSchedule, muted, onMute }) {
  const [tab, setTab] = useState("search"); const [q, setQ] = useState(""); const [name, setName] = useState(nickname || ""); const [scheduled, setScheduled] = useState(""); const [when, setWhen] = useState("");
  useEffect(() => { setName(nickname || ""); setQ(""); setTab("search"); }, [target?.id, nickname]);
  if (!open || !target) return null;
  const filtered = (messages || []).filter((m) => norm(m.content).includes(norm(q)));
  const media = (messages || []).filter((m) => ["image","video","file"].includes(m.type) || m.file_url);
  return <div className="ux-overlay"><section className="ux-sheet chat-tools-sheet"><div className="sheet-handle"/><div className="tool-head"><div><span className="eyebrow">CHAT TOOLS</span><h2>{kind === "dm" ? target.username : target.name}</h2></div><button onClick={onClose}><X/></button></div>
    <div className="tool-tabs"><button className={tab === "search" ? "active" : ""} onClick={() => setTab("search")}><Search/>Search</button><button className={tab === "media" ? "active" : ""} onClick={() => setTab("media")}><ImageIcon/>Media</button><button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}><Sparkles/>More</button></div>
    {tab === "search" && <><div className="search-box compact"><Search/><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search this conversation"/></div><div className="tool-results">{filtered.slice(-50).map((m) => <div key={m.id}><span>{m.content}</span><small>{new Date(m.created_at).toLocaleString()}</small></div>)}</div></>}
    {tab === "media" && <div className="media-grid">{media.length ? media.map((m) => m.type === "image" ? <img key={m.id} src={m.content || m.file_url} alt="Shared"/> : <a key={m.id} href={m.file_url || m.content} target="_blank" rel="noreferrer">{m.file_name || m.type}</a>) : <div className="search-empty"><ImageIcon/><strong>No media yet</strong></div>}</div>}
    {tab === "settings" && <div className="tool-settings"><button onClick={onTogglePin}><Pin/>{pinned ? "Unpin" : "Pin"} conversation</button>{kind === "space" && <button onClick={onMute}><BellOff/>{muted ? "Unmute" : "Mute"} Space</button>}{kind === "dm" && <><label><UserRoundPen/>Private nickname<input value={name} onChange={(e) => setName(e.target.value)} placeholder={target.username}/><button onClick={() => onNickname(name)}>Save</button></label><label><CalendarClock/>Schedule a message<textarea value={scheduled} onChange={(e) => setScheduled(e.target.value)} placeholder="Message"/><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}/><button disabled={!scheduled.trim() || !when} onClick={() => { onSchedule(scheduled, when); setScheduled(""); setWhen(""); }}>Schedule</button></label></>}</div>}
  </section></div>;
}

export function ReactionSettings({ userId }) {
  const [prefs, setPrefs] = useState(() => getUxPrefs(userId));
  const choices = ["❤️","😂","🔥","👀","⚡","👍","😭","💀","🎉","🤝"];
  return <div className="reaction-settings"><span>Quick reactions</span><div>{choices.map((e) => <button key={e} className={(prefs.favoriteReactions || []).includes(e) ? "selected" : ""} onClick={() => { const cur = prefs.favoriteReactions || []; const next = cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e].slice(-4); const p = updateUxPrefs(userId, { favoriteReactions: next }); setPrefs(p); }}>{e}</button>)}</div></div>;
}

export function PullToRefresh({ onRefresh, children }) {
  const [start, setStart] = useState(null); const [pull, setPull] = useState(0);
  const touchStart = (e) => { if (window.scrollY <= 0) setStart(e.touches[0].clientY); };
  const touchMove = (e) => { if (start == null) return; setPull(Math.max(0, Math.min(80, (e.touches[0].clientY - start) * 0.45))); };
  const touchEnd = async () => { const should = pull > 55; setStart(null); setPull(0); if (should) await onRefresh(); };
  return <div className="pull-shell" onTouchStart={touchStart} onTouchMove={touchMove} onTouchEnd={touchEnd}><div className="pull-indicator" style={{ transform:`translateY(${pull - 32}px)`, opacity:pull/55 }}><Clock3 size={16}/> Refresh</div>{children}</div>;
}
