import { useEffect, useMemo, useState } from "react";
import { Search, WifiOff, X, Pin, Clock3, Image as ImageIcon, CalendarClock, UserRoundPen, BellOff, Sparkles, ChevronRight, Flag, Ban, Repeat2, Bot, Mic2, SlidersHorizontal } from "lucide-react";
import { getUxPrefs, updateUxPrefs } from "./offline";
import { supabase } from "./supabaseClient";
import { paidTier, proAi } from "./premiumProData";

function norm(v) { return String(v || "").toLowerCase(); }
function isUuid(v) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || "")); }

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
  const [tab, setTab] = useState("search");
  const [q, setQ] = useState("");
  const [name, setName] = useState(nickname || "");
  const [scheduled, setScheduled] = useState("");
  const [when, setWhen] = useState("");
  const [recurrence, setRecurrence] = useState("once");
  const [tier, setTier] = useState("free");
  const [me, setMe] = useState(null);
  const [typeFilter, setTypeFilter] = useState("all");
  const [senderFilter, setSenderFilter] = useState("all");
  const [timeFilter, setTimeFilter] = useState("all");
  const [reporting, setReporting] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [status, setStatus] = useState("");
  const [ask, setAsk] = useState("");
  const [aiReply, setAiReply] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [transcripts, setTranscripts] = useState({});

  useEffect(() => {
    setName(nickname || ""); setQ(""); setTab("search"); setStatus(""); setReportReason(""); setReporting(false); setAsk(""); setAiReply("");
    if (!open) return;
    supabase.auth.getUser().then(async ({ data }) => {
      const uid = data?.user?.id || null; setMe(uid);
      if (!uid) return;
      const { data: profile } = await supabase.from("profiles").select("is_premium,premium_until,tier").eq("id", uid).maybeSingle();
      setTier(paidTier(profile));
    }).catch(() => {});
  }, [open, target?.id, nickname]);

  if (!open || !target) return null;
  const premium = tier === "premium" || tier === "pro";
  const pro = tier === "pro";
  const cutoff = timeFilter === "day" ? Date.now() - 86400000 : timeFilter === "week" ? Date.now() - 7 * 86400000 : timeFilter === "month" ? Date.now() - 30 * 86400000 : 0;
  const filtered = (messages || []).filter((m) => {
    if (!norm(m.content).includes(norm(q))) return false;
    if (premium && typeFilter !== "all" && String(m.type || "text") !== typeFilter) return false;
    if (premium && senderFilter === "mine" && String(m.sender_id || m.user_id) !== String(me)) return false;
    if (premium && senderFilter === "theirs" && String(m.sender_id || m.user_id) === String(me)) return false;
    if (premium && cutoff && new Date(m.created_at).getTime() < cutoff) return false;
    return true;
  });
  const media = (messages || []).filter((m) => ["image","video","file","audio"].includes(m.type) || m.file_url);

  async function reportUser() {
    if (!me || kind !== "dm" || !reportReason.trim()) return;
    setStatus("Sending report…");
    const { error } = await supabase.from("flags").insert({ reporter_id: me, reported_user_id: target.id, reason: reportReason.trim() });
    if (error) { setStatus("Report failed. Try again."); return; }
    setReporting(false); setReportReason(""); setStatus("Report sent to Wavo Safety.");
  }

  async function reportMessage(message) {
    if (!me || !isUuid(message?.id)) return;
    const reason = window.prompt("Why are you reporting this message?", "Offensive or unsafe content");
    if (!reason?.trim()) return;
    const sender = String(message.sender_id || message.user_id || "");
    const payload = { reporter_id: me, message_id: message.id, reason: reason.trim() };
    if (isUuid(sender)) payload.reported_user_id = sender;
    const { error } = await supabase.from("flags").insert(payload);
    setStatus(error ? "Report failed. Try again." : "Message reported to Wavo Safety.");
  }

  async function blockUser() {
    if (!me || kind !== "dm") return;
    if (!window.confirm(`Block @${target.username}? They will be removed from your friends and won't be able to message you.`)) return;
    setStatus("Blocking…");
    const { error } = await supabase.rpc("block_user", { target: target.id });
    if (error) { setStatus("Block failed. Try again."); return; }
    setStatus("Blocked.");
    window.setTimeout(() => { onClose(); window.location.reload(); }, 450);
  }

  async function scheduleMessage() {
    if (!scheduled.trim() || !when) return;
    if (recurrence === "once") {
      await onSchedule(scheduled, when); setStatus("Message scheduled.");
    } else {
      if (!premium || !me || kind !== "dm") return;
      const chatId = [me, target.id].sort().join("_");
      const { error } = await supabase.rpc("schedule_message_v2", {
        p_kind: "dm", p_conversation_id: chatId, p_recipient: target.id, p_content: scheduled.trim(),
        p_send_at: new Date(when).toISOString(), p_recurrence_rule: recurrence, p_recurrence_every: 1, p_occurrence_limit: null,
      });
      if (error) { setStatus(error.message || "Could not schedule recurring message."); return; }
      setStatus(`Recurring ${recurrence} message scheduled.`);
    }
    setScheduled(""); setWhen(""); setRecurrence("once");
  }

  async function runAi(action) {
    if (!pro) return;
    setAiBusy(true); setAiReply("");
    try {
      const context = (messages || []).slice(-160).map((m) => `${String(m.sender_id || m.user_id) === String(me) ? "You" : (kind === "dm" ? target.username : "Member")}: ${m.content || `[${m.type || "message"}]`}`).join("\n");
      const result = await proAi(action, { context, question: ask });
      setAiReply(result?.reply || "No summary returned.");
    } catch (err) { setAiReply(err?.message || "Wavo Pro AI could not answer."); }
    setAiBusy(false);
  }

  async function transcribe(message) {
    if (!pro) return;
    const audioUrl = message.file_url || message.content;
    if (!audioUrl) return;
    setTranscripts((x) => ({ ...x, [message.id]: "Transcribing…" }));
    try {
      const result = await proAi("transcribe", { audioUrl });
      setTranscripts((x) => ({ ...x, [message.id]: result?.transcript || "No speech detected." }));
    } catch (err) { setTranscripts((x) => ({ ...x, [message.id]: err?.message || "Transcription failed." })); }
  }

  return <div className="ux-overlay"><section className="ux-sheet chat-tools-sheet"><div className="sheet-handle"/><div className="tool-head"><div><span className="eyebrow">CHAT TOOLS</span><h2>{kind === "dm" ? target.username : target.name}</h2></div><button onClick={onClose}><X/></button></div>
    <div className="tool-tabs"><button className={tab === "search" ? "active" : ""} onClick={() => setTab("search")}><Search/>Search</button><button className={tab === "media" ? "active" : ""} onClick={() => setTab("media")}><ImageIcon/>Media</button><button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}><Sparkles/>More</button></div>
    {status && <div className="wavo-tool-status">{status}</div>}
    {tab === "search" && <><div className="search-box compact"><Search/><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search this conversation"/></div>
      {premium && <div className="premium-search-filters"><SlidersHorizontal size={15}/><select value={senderFilter} onChange={(e) => setSenderFilter(e.target.value)}><option value="all">Everyone</option><option value="mine">Sent by me</option><option value="theirs">Sent by them</option></select><select value={timeFilter} onChange={(e) => setTimeFilter(e.target.value)}><option value="all">Any time</option><option value="day">24 hours</option><option value="week">7 days</option><option value="month">30 days</option></select><select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}><option value="all">Everything</option><option value="text">Text</option><option value="image">Images</option><option value="audio">Voice</option><option value="file">Files</option></select></div>}
      {!premium && <small className="premium-hint">Premium adds sender, date and media filters.</small>}
      <div className="tool-results">{filtered.slice(-80).map((m) => <div key={m.id}><span>{m.content || `[${m.type || "message"}]`}</span><small>{new Date(m.created_at).toLocaleString()}</small>{String(m.sender_id || m.user_id) !== String(me) && isUuid(m.id) && <button className="report-message-btn" onClick={() => reportMessage(m)}><Flag size={12}/> Report</button>}</div>)}</div></>}
    {tab === "media" && <div className="media-grid">{media.length ? media.map((m) => m.type === "image" ? <img key={m.id} src={m.content || m.file_url} alt="Shared"/> : <div key={m.id} className="media-file-card"><a href={m.file_url || m.content} target="_blank" rel="noreferrer">{m.file_name || (m.type === "audio" ? "Voice note" : m.type)}</a>{m.type === "audio" && <>{pro ? <button onClick={() => transcribe(m)}><Mic2 size={14}/> Transcribe</button> : <small>Voice transcription · Pro</small>}{transcripts[m.id] && <p>{transcripts[m.id]}</p>}</>}</div>) : <div className="search-empty"><ImageIcon/><strong>No media yet</strong></div>}</div>}
    {tab === "settings" && <div className="tool-settings">
      <button onClick={onTogglePin}><Pin/>{pinned ? "Unpin" : "Pin"} conversation</button>
      {kind === "space" && <button onClick={onMute}><BellOff/>{muted ? "Unmute" : "Mute"} Space</button>}
      {kind === "dm" && <><label><UserRoundPen/>Private nickname<input value={name} onChange={(e) => setName(e.target.value)} placeholder={target.username}/><button onClick={() => onNickname(name)}>Save</button></label>
        <label><CalendarClock/>Schedule a message<textarea value={scheduled} onChange={(e) => setScheduled(e.target.value)} placeholder="Message"/><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}/>{premium && <select value={recurrence} onChange={(e) => setRecurrence(e.target.value)}><option value="once">Send once</option><option value="daily">Repeat daily</option><option value="weekly">Repeat weekly</option><option value="monthly">Repeat monthly</option></select>}<button disabled={!scheduled.trim() || !when} onClick={scheduleMessage}>{recurrence === "once" ? "Schedule" : <><Repeat2 size={14}/> Schedule recurring</>}</button>{!premium && <small>Recurring schedules are included with Premium.</small>}</label>
        <div className="safety-actions"><strong>Safety</strong><button onClick={() => setReporting((x) => !x)}><Flag/>Report user</button>{reporting && <div className="report-box"><textarea value={reportReason} onChange={(e) => setReportReason(e.target.value)} maxLength={500} placeholder="Tell Wavo Safety what happened"/><button disabled={!reportReason.trim()} onClick={reportUser}>Send report</button></div>}<button className="danger" onClick={blockUser}><Ban/>Block @{target.username}</button></div>
      </>}
      <div className="pro-ai-tools"><strong><Bot size={16}/> Wavo Pro AI</strong>{pro ? <><button disabled={aiBusy || !messages?.length} onClick={() => runAi("summary")}>{aiBusy ? "Thinking…" : "Summarise this chat"}</button><label>Ask about this conversation<input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="What time did we agree on?"/><button disabled={aiBusy || !ask.trim()} onClick={() => runAi("ask")}>Ask Wavo</button></label>{aiReply && <div className="ai-reply">{aiReply}</div>}</> : <small>Summaries, chat Q&A and voice transcription are included with Wavo Pro.</small>}</div>
    </div>}
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
