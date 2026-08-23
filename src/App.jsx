import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  CalendarDays,
  Check,
  ChevronLeft,
  Clock3,
  Gamepad2,
  Home,
  LogOut,
  MapPin,
  MessageCircle,
  Plus,
  Search,
  Send,
  Settings,
  Shield,
  Sparkles,
  User,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { supabase } from "./supabaseClient";
import { registerServiceWorker, ensureNotificationPermission, subscribeToPush } from "./push";
import {
  createActivity,
  createPlan,
  createPoll,
  createPost,
  createSpace,
  createWave,
  getActiveLocationShares,
  getActivities,
  getDmMessages,
  getFriends,
  getIncomingFriendRequests,
  getPlans,
  getPolls,
  getPosts,
  getPrivacySettings,
  getProfile,
  getSpaceMessages,
  getSpaces,
  getWaves,
  reactToWave,
  reactToPost,
  deletePost,
  respondFriendRequest,
  searchProfiles,
  sendDmMessage,
  sendFriendRequest,
  sendSpaceMessage,
  setRsvp,
  sharePlanLocation,
  stopAllLocationSharing,
  updatePrivacySettings,
  votePoll,
} from "./wavoData";
import "./styles.css";
import "./mobile-ux.css";
import { OfflineBanner, Onboarding, UniversalSearch, CatchUpCard, QuickAccess, ChatTools, ReactionSettings, PullToRefresh } from "./MobileUX";
import { cacheAppData, loadCachedAppData, cacheMessages, loadCachedMessages, getDraft, setDraft, getUxPrefs, updateUxPrefs, rememberRecent, queueOutbox, getOutbox, removeOutboxItem } from "./offline";
import { getChatPins, setChatPinned, getNicknames, setNickname, deleteDmMessage, deleteSpaceMessage, scheduleDmMessage, markDmRead } from "./uxData";

const GENERIC_ERROR = "Sorry, something went wrong. Please try again.";
const CREATE_TYPES = [
  { id: "post", label: "Post", hint: "Share something that stays", icon: MessageCircle },
  { id: "wave", label: "Wave", hint: "Share something quick", icon: Sparkles },
  { id: "plan", label: "Plan", hint: "Get everyone organised", icon: CalendarDays },
  { id: "poll", label: "Poll", hint: "Decide together", icon: Check },
  { id: "activity", label: "Activity", hint: "Start something together", icon: Gamepad2 },
  { id: "space", label: "Space", hint: "Create a home for your group", icon: Users },
];

function initials(name) {
  return (name?.trim()?.[0] || "W").toUpperCase();
}

function Avatar({ profile, size = "md" }) {
  return (
    <div className={`avatar avatar-${size}`}>
      {profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : initials(profile?.username)}
    </div>
  );
}

function formatRelative(ts) {
  if (!ts) return "";
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.max(0, Math.floor(diff / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function formatPlanTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Toast({ message, onClose }) {
  if (!message) return null;
  return (
    <button className="toast" onClick={onClose}>
      {message}
    </button>
  );
}

function AuthScreen({ onReady }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const email = `${username.trim().toLowerCase()}@wavo.app`;
    try {
      if (mode === "login") {
        const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) throw authError;
        onReady?.(data.session);
      } else {
        const { data, error: authError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { username: username.trim() } },
        });
        if (authError) throw authError;
        if (!data.user) throw new Error("Signup failed");
        setMode("login");
        setPassword("");
        setError("Account created. Log in to enter Wavo.");
      }
    } catch (err) {
      const msg = String(err?.message || "").toLowerCase();
      setError(msg.includes("invalid login") ? "Incorrect username or password." : GENERIC_ERROR);
      console.error("[wavo] auth", err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-orbit auth-orbit-a" />
      <div className="auth-orbit auth-orbit-b" />
      <section className="auth-card">
        <div className="wavo-mark">W</div>
        <div>
          <span className="eyebrow">YOUR PEOPLE, TOGETHER</span>
          <h1>Welcome to Wavo.</h1>
          <p className="muted">Talk, decide, plan and actually do things with the people you know.</p>
        </div>
        <form onSubmit={submit} className="stack-form">
          <label>
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoCorrect="off" required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
          </label>
          {error && <div className="form-note">{error}</div>}
          <button className="primary-btn" disabled={busy}>{busy ? "Working…" : mode === "login" ? "Enter Wavo" : "Create account"}</button>
        </form>
        <button className="text-btn" onClick={() => setMode(mode === "login" ? "signup" : "login")}>{mode === "login" ? "New here? Create an account" : "Already have an account? Log in"}</button>
      </section>
    </main>
  );
}

function BottomNav({ tab, setTab, openCreate }) {
  const items = [
    ["home", "Home", Home],
    ["spaces", "Spaces", Users],
    ["create", "Create", Plus],
    ["inbox", "Inbox", MessageCircle],
    ["you", "You", User],
  ];
  return (
    <nav className="bottom-nav">
      {items.map(([id, label, Icon]) => id === "create" ? (
        <button key={id} className="nav-create" onClick={openCreate} aria-label="Create"><Icon size={24} /></button>
      ) : (
        <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
          <Icon size={20} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function Header({ profile, pendingCount, onBell, onSearch }) {
  return (
    <header className="app-header">
      <div className="brand-lockup"><div className="mini-mark">W</div><strong>Wavo</strong></div>
      <button className="mobile-search-trigger" onClick={onSearch} aria-label="Search Wavo"><Search size={19} /></button>
      <button className="icon-button" onClick={onBell} aria-label="Notifications">
        <Bell size={20} />
        {pendingCount > 0 && <span className="badge-dot">{pendingCount > 9 ? "9+" : pendingCount}</span>}
      </button>
      <Avatar profile={profile} size="sm" />
    </header>
  );
}

function PlanCard({ plan, userId, onRsvp, onShareLocation }) {
  const mine = plan.rsvps?.find((r) => r.user_id === userId)?.response;
  const going = plan.rsvps?.filter((r) => r.response === "going").length || 0;
  return (
    <article className="plan-card">
      <div className="plan-icon"><CalendarDays size={20} /></div>
      <div className="plan-main">
        <div className="card-row"><strong>{plan.title}</strong><span className="tiny-pill">{going} going</span></div>
        <span className="subline"><Clock3 size={14} /> {formatPlanTime(plan.starts_at)}</span>
        {plan.location && <span className="subline"><MapPin size={14} /> {plan.location}</span>}
        <div className="button-row compact">
          {[
            ["going", "Going"],
            ["maybe", "Maybe"],
            ["not_going", "Can't"],
          ].map(([value, label]) => <button key={value} className={mine === value ? "chip active" : "chip"} onClick={() => onRsvp(plan.id, value)}>{label}</button>)}
          <button className="chip location-chip" onClick={() => onShareLocation(plan)}><MapPin size={13} /> Share arrival</button>
        </div>
      </div>
    </article>
  );
}

function PollCard({ poll, userId, onVote }) {
  const total = poll.votes?.length || 0;
  const myVotes = new Set((poll.votes || []).filter((v) => v.user_id === userId).map((v) => v.option_id));
  return (
    <article className="poll-card">
      <span className="eyebrow">GROUP DECISION</span>
      <h3>{poll.question}</h3>
      <div className="poll-options">
        {(poll.options || []).map((option) => {
          const count = (poll.votes || []).filter((v) => v.option_id === option.id).length;
          const pct = total ? Math.round((count / total) * 100) : 0;
          return (
            <button key={option.id} className={myVotes.has(option.id) ? "poll-option selected" : "poll-option"} onClick={() => onVote(poll, option.id)}>
              <span>{option.label}</span><strong>{pct}%</strong><i style={{ width: `${pct}%` }} />
            </button>
          );
        })}
      </div>
      <span className="muted small">{total} vote{total === 1 ? "" : "s"}</span>
    </article>
  );
}

function WaveCard({ wave, onReact }) {
  const counts = (wave.reactions || []).reduce((acc, r) => ({ ...acc, [r.emoji]: (acc[r.emoji] || 0) + 1 }), {});
  return (
    <article className="wave-card">
      <div className="wave-head">
        <Avatar profile={wave.author} size="sm" />
        <div><strong>{wave.author?.username || "Wavo user"}</strong><span>{formatRelative(wave.created_at)}</span></div>
        <span className="wave-mark">〰</span>
      </div>
      <p>{wave.body}</p>
      <div className="reaction-row">
        {["❤️", "😂", "⚡", "👀"].map((emoji) => <button key={emoji} onClick={() => onReact(wave.id, emoji)}>{emoji}{counts[emoji] ? ` ${counts[emoji]}` : ""}</button>)}
      </div>
    </article>
  );
}


function PostCard({ post, userId, onReact, onDelete }) {
  const counts = (post.reactions || []).reduce((acc, r) => ({ ...acc, [r.emoji]: (acc[r.emoji] || 0) + 1 }), {});
  const mine = (post.reactions || []).find((r) => r.user_id === userId)?.emoji;
  const ownPost = post.author_id === userId;
  return (
    <article className="post-card">
      <div className="wave-head">
        <Avatar profile={post.author} size="sm" />
        <div><strong>{post.author?.username || "Wavo user"}</strong><span>{formatRelative(post.created_at)}</span></div>
        <span className="tiny-pill">{post.visibility === "selected" ? "SELECTED" : "ALL FRIENDS"}</span>
      </div>
      <p>{post.body}</p>
      <div className="post-card-actions">
        <div className="reaction-row">
          {["❤️", "😂", "🔥", "👀"].map((emoji) => (
            <button key={emoji} className={mine === emoji ? "selected" : ""} onClick={() => onReact(post.id, emoji)}>
              {emoji}{counts[emoji] ? ` ${counts[emoji]}` : ""}
            </button>
          ))}
        </div>
        {ownPost && <button className="post-delete" onClick={() => onDelete(post.id)} aria-label="Delete post"><X size={15} /></button>}
      </div>
    </article>
  );
}

function HomeScreen({ profile, friends, spaces, posts, waves, plans, polls, requests, activities, pins, userId, actions }) {
  const upcoming = plans.filter((p) => new Date(p.starts_at) >= new Date()).slice(0, 4);
  const needsVote = polls.filter((p) => !(p.votes || []).some((v) => v.user_id === userId)).slice(0, 2);
  return (
    <div className="screen home-screen">
      <section className="hero-card">
        <span className="eyebrow">YOUR PEOPLE, RIGHT NOW</span>
        <h1>Hey {profile?.username || "there"}.</h1>
        <p>{spaces.length} Space{spaces.length === 1 ? "" : "s"} · {upcoming.length} upcoming plan{upcoming.length === 1 ? "" : "s"} · {posts.length} friend post{posts.length === 1 ? "" : "s"}</p>
      </section>
      <CatchUpCard requests={requests} plans={plans} polls={polls} userId={userId} />
      <QuickAccess userId={userId} friends={friends} spaces={spaces} pins={pins || []} onFriend={actions.openFriend} onSpace={actions.openSpace} />

      {(requests.length > 0 || needsVote.length > 0) && (
        <section>
          <div className="section-heading"><div><span className="eyebrow">NEEDS YOU</span><h2>Quick decisions</h2></div></div>
          <div className="attention-grid">
            {requests.slice(0, 2).map((r) => <div className="attention-card" key={r.id}><UserPlus size={20} /><div><strong>{r.sender?.username || "Someone"}</strong><span>wants to be friends</span></div><button onClick={() => actions.respondRequest(r.id, "accepted")}>Accept</button></div>)}
            {needsVote.map((p) => <div className="attention-card" key={p.id}><Check size={20} /><div><strong>Vote needed</strong><span>{p.question}</span></div></div>)}
          </div>
        </section>
      )}

      <section>
        <div className="section-heading"><div><span className="eyebrow">HAPPENING</span><h2>Plans</h2></div><button className="text-btn" onClick={() => actions.openCreate("plan")}>New plan</button></div>
        {upcoming.length ? <div className="cards-stack">{upcoming.map((plan) => <PlanCard key={plan.id} plan={plan} userId={userId} onRsvp={actions.rsvp} onShareLocation={actions.shareLocation} />)}</div> : <div className="empty-card"><CalendarDays /><strong>Nothing planned yet</strong><span>Make a plan and stop losing decisions inside 150 messages.</span><button onClick={() => actions.openCreate("plan")}>Create a plan</button></div>}
      </section>

      {needsVote.map((poll) => <PollCard key={poll.id} poll={poll} userId={userId} onVote={actions.vote} />)}


      <section>
        <div className="section-heading"><div><span className="eyebrow">POSTS</span><h2>From friends</h2></div><button className="text-btn" onClick={() => actions.openCreate("post")}>New post</button></div>
        {posts.length ? <div className="cards-stack">{posts.map((post) => <PostCard key={post.id} post={post} userId={userId} onReact={actions.reactPost} onDelete={actions.deletePost} />)}</div> : <div className="empty-card"><MessageCircle /><strong>No posts yet</strong><span>Posts stay around, and you choose which friends get to see each one.</span><button onClick={() => actions.openCreate("post")}>Post something</button></div>}
      </section>

      <section>
        <div className="section-heading"><div><span className="eyebrow">WAVES</span><h2>From your people</h2></div><button className="text-btn" onClick={() => actions.openCreate("wave")}>Send Wave</button></div>
        {waves.length ? <div className="cards-stack">{waves.map((wave) => <WaveCard key={wave.id} wave={wave} onReact={actions.react} />)}</div> : <div className="empty-card"><Sparkles /><strong>No Waves yet</strong><span>A Wave is a quick update for friends or a Space, not a public performance.</span><button onClick={() => actions.openCreate("wave")}>Send the first one</button></div>}
      </section>

      {activities.length > 0 && <section><div className="section-heading"><div><span className="eyebrow">ACTIVE</span><h2>Things your Spaces started</h2></div></div><div className="mini-grid">{activities.slice(0, 4).map((a) => <div className="mini-card" key={a.id}><Gamepad2 /><strong>{a.title}</strong><span>{a.type.replaceAll("_", " ")}</span></div>)}</div></section>}
    </div>
  );
}

function SpacesScreen({ spaces, selectedSpace, setSelectedSpace, messages, messageText, setMessageText, sendMessage, plans, polls, activities, userId, actions }) {
  if (selectedSpace) {
    const spacePlans = plans.filter((p) => p.group_id === selectedSpace.id);
    const spacePolls = polls.filter((p) => p.group_id === selectedSpace.id);
    const spaceActivities = activities.filter((a) => a.group_id === selectedSpace.id);
    return (
      <div className="screen">
        <div className="mobile-detail-bar"><button className="back-button" onClick={() => setSelectedSpace(null)}><ChevronLeft size={18} /> Spaces</button><button className="mobile-tools-button" onClick={() => actions.openChatTools("space", selectedSpace)} aria-label="Space tools"><Settings size={18}/></button></div>
        <section className="space-hero">
          <div className="space-emoji large">{selectedSpace.emoji || "🌊"}</div>
          <div><span className="eyebrow">SPACE</span><h1>{selectedSpace.name}</h1><p>{selectedSpace.description || "Your shared corner of Wavo."}</p></div>
        </section>
        <div className="quick-actions">
          <button onClick={() => actions.openCreate("plan", selectedSpace.id)}><CalendarDays />Plan</button>
          <button onClick={() => actions.openCreate("poll", selectedSpace.id)}><Check />Poll</button>
          <button onClick={() => actions.openCreate("activity", selectedSpace.id)}><Gamepad2 />Activity</button>
          <button onClick={() => actions.openCreate("wave", selectedSpace.id)}><Sparkles />Wave</button>
        </div>
        {spacePlans.length > 0 && <section><div className="section-heading"><h2>Plans</h2></div><div className="cards-stack">{spacePlans.slice(0, 3).map((p) => <PlanCard key={p.id} plan={p} userId={userId} onRsvp={actions.rsvp} onShareLocation={actions.shareLocation} />)}</div></section>}
        {spacePolls.length > 0 && <section><div className="section-heading"><h2>Decisions</h2></div>{spacePolls.slice(0, 2).map((p) => <PollCard key={p.id} poll={p} userId={userId} onVote={actions.vote} />)}</section>}
        {spaceActivities.length > 0 && <section><div className="section-heading"><h2>Activities</h2></div><div className="mini-grid">{spaceActivities.map((a) => <div key={a.id} className="mini-card"><Gamepad2 /><strong>{a.title}</strong><span>{a.type.replaceAll("_", " ")}</span></div>)}</div></section>}
        <section className="space-chat-card">
          <div className="section-heading"><div><span className="eyebrow">PERSISTENT CHAT</span><h2>Conversation</h2></div></div>
          <div className="space-messages">
            {messages.length === 0 && <div className="muted center">Start the conversation.</div>}
            {messages.map((m) => <div key={m.id} className={m.sender_id === userId || m.user_id === userId ? "space-message mine" : "space-message"}><span>{m.sender?.username || (m.sender_id === userId || m.user_id === userId ? "You" : "Member")}</span><p>{m.deleted_at ? "Message deleted" : m.content}</p></div>)}
          </div>
          <form className="composer" onSubmit={sendMessage}><input value={messageText} onChange={(e) => setMessageText(e.target.value)} placeholder={`Message ${selectedSpace.name}`} /><button><Send size={18} /></button></form>
        </section>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="screen-title"><div><span className="eyebrow">YOUR GROUPS</span><h1>Spaces</h1><p>A shared home for plans, decisions, activities and chat.</p></div><button className="round-action" onClick={() => actions.openCreate("space")}><Plus /></button></div>
      {spaces.length ? <div className="space-grid">{spaces.map((space) => <button className="space-card" key={space.id} onClick={() => setSelectedSpace(space)}><div className="space-emoji">{space.emoji || "🌊"}</div><div><strong>{space.name}</strong><span>{space.description || "Open your Space"}</span></div><span className="tiny-pill">{space.role}</span></button>)}</div> : <div className="empty-card big"><Users /><strong>Your first Space starts here</strong><span>Create one for your closest friends, gaming crew, team or whatever group actually matters.</span><button onClick={() => actions.openCreate("space")}>Create Space</button></div>}
    </div>
  );
}

function InboxScreen({ friends, requests, selectedFriend, setSelectedFriend, messages, messageText, setMessageText, sendMessage, userId, actions, nicknames = {} }) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  async function runSearch(e) {
    e.preventDefault();
    setSearching(true);
    try { setResults(await searchProfiles(search, userId)); } catch (err) { console.error(err); }
    setSearching(false);
  }

  if (selectedFriend) {
    return (
      <div className="chat-screen">
        <header className="chat-topbar"><button onClick={() => setSelectedFriend(null)}><ChevronLeft /></button><Avatar profile={selectedFriend} size="sm" /><div><strong>{nicknames[selectedFriend.id] || selectedFriend.username}</strong><span>{nicknames[selectedFriend.id] ? `@${selectedFriend.username}` : (selectedFriend.status || "Wavo friend")}</span></div><button className="mobile-tools-button" onClick={() => actions.openChatTools("dm", selectedFriend)} aria-label="Chat tools"><Settings size={18}/></button></header>
        <div className="dm-messages">
          {messages.map((m) => <div key={m.id} className={m.sender_id === userId ? "dm-row mine" : "dm-row"}><div className="dm-bubble">{m.type === "image" ? <img src={m.content} alt="Shared" /> : <p>{m.deleted_at ? "Message deleted" : m.content}</p>}<span>{formatRelative(m.created_at)}</span></div></div>)}
        </div>
        <form className="composer dm-composer" onSubmit={sendMessage}><input value={messageText} onChange={(e) => setMessageText(e.target.value)} placeholder={`Message ${selectedFriend.username}`} /><button><Send size={18} /></button></form>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="screen-title"><div><span className="eyebrow">MESSAGES</span><h1>Inbox</h1><p>Persistent conversations with people you actually added.</p></div></div>
      {requests.length > 0 && <section><div className="section-heading"><h2>Friend requests</h2></div><div className="request-list">{requests.map((r) => <div className="friend-row" key={r.id}><Avatar profile={r.sender} size="sm" /><div><strong>{r.sender?.username}</strong><span>wants to connect</span></div><button className="chip active" onClick={() => actions.respondRequest(r.id, "accepted")}>Accept</button><button className="chip" onClick={() => actions.respondRequest(r.id, "declined")}>Decline</button></div>)}</div></section>}
      <section className="add-friend-card"><div><UserPlus /><strong>Add someone</strong></div><form onSubmit={runSearch}><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search username" /><button>{searching ? "…" : "Search"}</button></form>{results.map((p) => <div className="friend-row search-result" key={p.id}><Avatar profile={p} size="sm" /><div><strong>{p.username}</strong><span>{p.status || "Wavo user"}</span></div><button onClick={() => actions.addFriend(p.id)}>Add</button></div>)}</section>
      <section><div className="section-heading"><h2>Friends</h2><span className="tiny-pill">{friends.length}</span></div>{friends.length ? <div className="friend-list">{friends.map((friend) => <button className="friend-row friend-button" key={friend.id} onClick={() => setSelectedFriend(friend)}><Avatar profile={friend} size="md" /><div><strong>{friend.username}</strong><span>{friend.status || "Tap to message"}</span></div><MessageCircle size={18} /></button>)}</div> : <div className="empty-card"><MessageCircle /><strong>No conversations yet</strong><span>Add a friend above, then messages stay here instead of disappearing.</span></div>}</section>
    </div>
  );
}

function ProfileScreen({ profile, posts, userId, onPostReact, onPostDelete, onNewPost, privacy, locations, onPrivacy, onProfileSaved, onEnableNotifications, onStopLocations, onLogout }) {
  const [bio, setBio] = useState(profile?.bio || "");
  const [status, setStatus] = useState(profile?.status || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => { setBio(profile?.bio || ""); setStatus(profile?.status || ""); }, [profile]);

  async function saveProfile(e) {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.from("profiles").update({ bio: bio.trim() || null, status: status.trim() || null, last_active: new Date().toISOString() }).eq("id", profile.id);
    setSaving(false);
    if (!error) onProfileSaved();
  }

  return (
    <div className="screen">
      <div className="profile-hero"><Avatar profile={profile} size="xl" /><div><span className="eyebrow">YOUR WAVO</span><h1>{profile?.username}</h1><p>@{profile?.username}</p></div></div>

      <section>
        <div className="section-heading"><div><span className="eyebrow">YOUR POSTS</span><h2>What you've shared</h2></div><button className="text-btn" onClick={onNewPost}>New post</button></div>
        {posts.length ? <div className="cards-stack">{posts.map((post) => <PostCard key={post.id} post={post} userId={userId} onReact={onPostReact} onDelete={onPostDelete} />)}</div> : <div className="empty-card"><MessageCircle /><strong>Nothing posted yet</strong><span>Your persistent friend posts will live here.</span></div>}
      </section>
      <form className="settings-card" onSubmit={saveProfile}><div className="settings-head"><Sparkles /><div><strong>Identity</strong><span>Keep it lightweight. You're here for people, not follower counts.</span></div></div><label>Status<input value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Gaming, studying, out…" /></label><label>Bio<textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={180} placeholder="A sentence about you" /></label><ReactionSettings userId={userId} /><button className="secondary-btn">{saving ? "Saving…" : "Save profile"}</button></form>

      <section className="settings-card"><div className="settings-head"><Shield /><div><strong>Privacy Centre</strong><span>You decide what Wavo exposes.</span></div></div>
        {privacy && <>
          <ToggleRow label="Show online status" value={privacy.show_online} onChange={(value) => onPrivacy({ show_online: value })} />
          <ToggleRow label="Read receipts" value={privacy.read_receipts} onChange={(value) => onPrivacy({ read_receipts: value })} />
          <ToggleRow label="Allow friend requests" value={privacy.allow_friend_requests} onChange={(value) => onPrivacy({ allow_friend_requests: value })} />
          <label>Default location sharing<select value={privacy.location_default} onChange={(e) => onPrivacy({ location_default: e.target.value })}><option value="off">Off</option><option value="approximate">Approximate</option><option value="precise">Precise</option></select></label>
        </>}
      </section>

      <section className="settings-card"><div className="settings-head"><MapPin /><div><strong>Location sharing</strong><span>{locations.length ? `${locations.length} active share${locations.length === 1 ? "" : "s"}` : "Nothing is being shared"}</span></div></div>{locations.length > 0 && <button className="danger-soft" onClick={onStopLocations}>Stop all location sharing</button>}</section>
      <section className="settings-card"><div className="settings-head"><Bell /><div><strong>Notifications</strong><span>Enable message and plan alerts when you want them.</span></div></div><button className="secondary-btn" onClick={onEnableNotifications}>Enable notifications</button></section>
      <button className="logout-button" onClick={onLogout}><LogOut size={18} /> Log out</button>
    </div>
  );
}

function ToggleRow({ label, value, onChange }) {
  return <button type="button" className="toggle-row" onClick={() => onChange(!value)}><span>{label}</span><i className={value ? "toggle on" : "toggle"}><b /></i></button>;
}

function CreateModal({ mode, setMode, spaces, friends, presetSpace, onClose, onCreated, userId }) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    body: "", postVisibility: "friends", postRecipients: [], audience: presetSpace ? "space" : "friends", groupId: presetSpace || spaces[0]?.id || "", title: "", location: "", startsAt: "", notes: "", question: "", option1: "", option2: "", option3: "", activityType: "would_you_rather", items: "", name: "", description: "", emoji: "🌊",
  });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "post") await createPost(userId, { body: form.body, visibility: form.postVisibility, recipientIds: form.postRecipients });
      if (mode === "wave") await createWave(userId, { body: form.body, audience: form.audience, groupId: form.audience === "space" ? form.groupId : null });
      if (mode === "plan") await createPlan(userId, { groupId: form.groupId, title: form.title, location: form.location, startsAt: new Date(form.startsAt).toISOString(), notes: form.notes });
      if (mode === "poll") await createPoll(userId, { groupId: form.groupId, question: form.question, options: [form.option1, form.option2, form.option3] });
      if (mode === "activity") await createActivity(userId, { groupId: form.groupId, type: form.activityType, title: form.title, items: form.items.split("\n").map((x) => x.trim()).filter(Boolean) });
      if (mode === "space") await createSpace(userId, { name: form.name, description: form.description, emoji: form.emoji });
      await onCreated();
      onClose();
    } catch (err) {
      console.error("[wavo] create", err);
      alert(GENERIC_ERROR);
    } finally { setBusy(false); }
  }

  const needSpace = ["plan", "poll", "activity"].includes(mode) || (mode === "wave" && form.audience === "space");

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="create-modal">
        <div className="modal-grabber" />
        <div className="modal-head"><div><span className="eyebrow">START SOMETHING</span><h2>{mode ? CREATE_TYPES.find((t) => t.id === mode)?.label : "Create"}</h2></div><button className="icon-button" onClick={onClose}><X /></button></div>
        {!mode ? <div className="create-grid">{CREATE_TYPES.map(({ id, label, hint, icon: Icon }) => <button key={id} onClick={() => setMode(id)}><Icon /><div><strong>{label}</strong><span>{hint}</span></div></button>)}</div> : (
          <form className="stack-form create-form" onSubmit={submit}>
            {mode === "post" && <>
              <label>Post<textarea required value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="What do you want to share?" maxLength={2000} /></label>
              <label>Who can see this?
                <select value={form.postVisibility} onChange={(e) => setForm({ ...form, postVisibility: e.target.value, postRecipients: e.target.value === "friends" ? [] : form.postRecipients })}>
                  <option value="friends">All friends</option>
                  <option value="selected">Choose people</option>
                </select>
              </label>
              {form.postVisibility === "selected" && <div className="post-audience-picker">
                <div className="audience-picker-head"><span>Choose people</span><strong>{form.postRecipients.length} selected</strong></div>
                {friends.length ? <div className="audience-list">{friends.map((friend) => {
                  const selected = form.postRecipients.includes(friend.id);
                  return <button type="button" key={friend.id} className={selected ? "audience-person selected" : "audience-person"} aria-pressed={selected} onClick={() => setForm({ ...form, postRecipients: selected ? form.postRecipients.filter((id) => id !== friend.id) : [...form.postRecipients, friend.id] })}>
                    <Avatar profile={friend} size="sm" />
                    <span>{friend.username}</span>
                    <i className="audience-check">{selected && <Check size={16} />}</i>
                  </button>;
                })}</div> : <div className="form-note">Add a friend first, then you can choose them here.</div>}
              </div>}
              <div className="form-note">Posts stay until you delete them. Only the audience you choose can open them.</div>
            </>}
            {mode === "wave" && <><label>Wave<textarea required value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="What's happening?" maxLength={500} /></label><label>Send to<select value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}><option value="friends">Friends</option><option value="space">A Space</option></select></label></>}
            {mode === "plan" && <><label>Plan name<input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Beach, dinner, gaming…" /></label><label>When<input required type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></label><label>Where<input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Optional place" /></label><label>Notes<textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label></>}
            {mode === "poll" && <><label>Question<input required value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} placeholder="Where are we eating?" /></label>{[1, 2, 3].map((n) => <label key={n}>Option {n}<input required={n < 3} value={form[`option${n}`]} onChange={(e) => setForm({ ...form, [`option${n}`]: e.target.value })} /></label>)}</>}
            {mode === "activity" && <><label>Activity<select value={form.activityType} onChange={(e) => setForm({ ...form, activityType: e.target.value })}><option value="would_you_rather">Would You Rather</option><option value="most_likely">Who's Most Likely</option><option value="this_or_that">This or That</option><option value="random_picker">Random Picker</option><option value="bracket">Bracket</option></select></label><label>Title<input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Tonight's chaos" /></label><label>Items<textarea value={form.items} onChange={(e) => setForm({ ...form, items: e.target.value })} placeholder={'One item per line\nPizza\nBurgers\nTacos'} /></label></>}
            {mode === "space" && <><label>Emoji<input className="emoji-input" value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })} maxLength={4} /></label><label>Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Summer Crew" /></label><label>Description<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What this Space is for" /></label></>}
            {needSpace && <label>Space<select required value={form.groupId} onChange={(e) => setForm({ ...form, groupId: e.target.value })}><option value="" disabled>Choose a Space</option>{spaces.map((s) => <option key={s.id} value={s.id}>{s.emoji || "🌊"} {s.name}</option>)}</select></label>}
            {needSpace && spaces.length === 0 && <div className="form-note">Create a Space first. Plans, polls and activities belong somewhere instead of floating around loose.</div>}
            <div className="modal-actions"><button type="button" className="text-btn" onClick={() => setMode(null)}>Back</button><button className="primary-btn" disabled={busy || (needSpace && !form.groupId) || (mode === "post" && form.postVisibility === "selected" && form.postRecipients.length === 0)}>{busy ? "Creating…" : `Create ${CREATE_TYPES.find((t) => t.id === mode)?.label}`}</button></div>
          </form>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [booting, setBooting] = useState(true);
  const [tab, setTab] = useState("home");
  const [data, setData] = useState({ profile: null, friends: [], requests: [], spaces: [], posts: [], waves: [], plans: [], polls: [], activities: [], privacy: null, locations: [], pins: [], nicknames: {} });
  const [createMode, setCreateMode] = useState(false);
  const [presetSpace, setPresetSpace] = useState(null);
  const [selectedFriend, setSelectedFriend] = useState(null);
  const [selectedSpace, setSelectedSpace] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState("");
  const [toast, setToast] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine);
  const [chatToolTarget, setChatToolTarget] = useState(null);
  const [undoSend, setUndoSend] = useState(null);

  const userId = session?.user?.id;

  useEffect(() => {
    const setConnection = () => setOnline(navigator.onLine);
    window.addEventListener("online", setConnection);
    window.addEventListener("offline", setConnection);
    const command = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSearchOpen(true); } };
    window.addEventListener("keydown", command);
    registerServiceWorker().catch(() => {});
    supabase.auth.getSession().then(({ data: authData }) => { setSession(authData.session || null); setBooting(false); });
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); setBooting(false); });
    return () => { authListener.subscription.unsubscribe(); window.removeEventListener("online", setConnection); window.removeEventListener("offline", setConnection); window.removeEventListener("keydown", command); };
  }, []);

  async function refresh() {
    if (!userId) return;
    try {
      const [profile, friends, requests, spaces, privacy, pins, nicknames] = await Promise.all([
        getProfile(userId), getFriends(userId), getIncomingFriendRequests(userId), getSpaces(userId), getPrivacySettings(userId), getChatPins(userId), getNicknames(userId),
      ]);
      const [posts, waves, plans, polls, activities, locations] = await Promise.all([
        getPosts(userId, friends), getWaves(), getPlans(userId, spaces), getPolls(), getActivities(), getActiveLocationShares(),
      ]);
      const next = { profile, friends, requests, spaces, posts, waves, plans, polls, activities, privacy, locations, pins, nicknames };
      setData(next);
      cacheAppData(userId, next);
    } catch (err) {
      console.error("[wavo] refresh", err);
      const cached = loadCachedAppData(userId);
      if (cached) { setData((prev) => ({ ...prev, ...cached })); setToast("Offline copy loaded"); }
      else setToast(GENERIC_ERROR);
    }
  }

  useEffect(() => {
    if (!userId) return;
    const cached = loadCachedAppData(userId);
    if (cached) setData((prev) => ({ ...prev, ...cached }));
    refresh();
  }, [userId]);

  useEffect(() => {
    if (!userId || !selectedFriend) { setMessages([]); return; }
    const chatId = [userId, selectedFriend.id].sort().join("_");
    const cacheKey = `dm:${chatId}`;
    const cached = loadCachedMessages(userId, cacheKey);
    if (cached.length) setMessages(cached);
    setMessageText(getDraft(userId, cacheKey));
    markDmRead(userId, selectedFriend.id).catch(() => {});
    const load = () => getDmMessages(userId, selectedFriend.id).then((r) => { setMessages(r.messages); cacheMessages(userId, cacheKey, r.messages); }).catch(() => {});
    load();
    const channel = supabase.channel(`wavo-dm:${chatId}`).on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` }, load).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, selectedFriend]);

  useEffect(() => {
    if (!selectedSpace) { if (!selectedFriend) setMessages([]); return; }
    const cacheKey = `space:${selectedSpace.id}`;
    const cached = loadCachedMessages(userId, cacheKey);
    if (cached.length) setMessages(cached);
    setMessageText(getDraft(userId, cacheKey));
    const load = () => getSpaceMessages(selectedSpace.id).then((rows) => { setMessages(rows); cacheMessages(userId, cacheKey, rows); }).catch(() => {});
    load();
    const channel = supabase.channel(`wavo-space:${selectedSpace.id}`).on("postgres_changes", { event: "*", schema: "public", table: "group_messages", filter: `group_id=eq.${selectedSpace.id}` }, load).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedSpace, userId]);

  useEffect(() => {
    if (!userId) return;
    const key = selectedFriend ? `dm:${[userId, selectedFriend.id].sort().join("_")}` : selectedSpace ? `space:${selectedSpace.id}` : null;
    if (key) setDraft(userId, key, messageText);
  }, [messageText, selectedFriend?.id, selectedSpace?.id, userId]);

  useEffect(() => {
    if (!userId || !online) return;
    let cancelled = false;
    (async () => {
      for (const item of getOutbox(userId)) {
        if (cancelled) break;
        try {
          if (item.kind === "dm") await sendDmMessage(userId, item.targetId, item.content);
          else await sendSpaceMessage(item.targetId, userId, item.content);
          removeOutboxItem(userId, item.id);
        } catch { break; }
      }
    })();
    return () => { cancelled = true; };
  }, [userId, online]);

  const actions = useMemo(() => ({
    openCreate: (mode = null, spaceId = null) => { setPresetSpace(spaceId); setCreateMode(mode || true); },
    openFriend: (friend) => { rememberRecent(userId, "friend", friend.id); setTab("inbox"); setSelectedSpace(null); setSelectedFriend(friend); },
    openSpace: (space) => { rememberRecent(userId, "space", space.id); setTab("spaces"); setSelectedFriend(null); setSelectedSpace(space); },
    openChatTools: (kind, target) => setChatToolTarget({ kind, target }),
    respondRequest: async (id, status) => { await respondFriendRequest(id, status); await refresh(); setToast(status === "accepted" ? "Friend added" : "Request updated"); },
    addFriend: async (receiverId) => { await sendFriendRequest(userId, receiverId); setToast("Friend request sent"); },
    rsvp: async (planId, response) => { await setRsvp(userId, planId, response); await refresh(); },
    vote: async (poll, optionId) => { await votePoll(userId, poll, optionId); await refresh(); },
    react: async (waveId, emoji) => { await reactToWave(userId, waveId, emoji); await refresh(); },
    reactPost: async (postId, emoji) => { await reactToPost(userId, postId, emoji); await refresh(); },
    deletePost: async (postId) => { await deletePost(userId, postId); await refresh(); setToast("Post deleted"); },
    shareLocation: async (plan) => {
      if (!navigator.geolocation) return setToast("Location isn't available on this device.");
      navigator.geolocation.getCurrentPosition(async (pos) => {
        try {
          const approximate = data.privacy?.location_default !== "precise";
          await sharePlanLocation(userId, plan.id, { latitude: pos.coords.latitude, longitude: pos.coords.longitude, precisionM: approximate ? Math.max(250, Math.round(pos.coords.accuracy || 250)) : Math.max(10, Math.round(pos.coords.accuracy || 20)), minutes: 60 });
          await refresh();
          setToast("Arrival sharing is on for 1 hour");
        } catch (err) { console.error(err); setToast(GENERIC_ERROR); }
      }, () => setToast("Location permission wasn't granted."), { enableHighAccuracy: data.privacy?.location_default === "precise", timeout: 10000 });
    },
  }), [userId, data.privacy]);

  async function sendCurrentMessage(e) {
    e.preventDefault();
    const content = messageText.trim();
    if (!content) return;
    const kind = selectedFriend ? "dm" : "space";
    const targetId = selectedFriend?.id || selectedSpace?.id;
    if (!targetId) return;
    setMessageText("");
    const tempId = `temp:${Date.now()}`;
    const optimistic = { id: tempId, sender_id: userId, user_id: userId, content, type: "text", created_at: new Date().toISOString(), queued: !online };
    setMessages((prev) => [...prev, optimistic]);
    if (!online) {
      const queued = queueOutbox(userId, { kind, targetId, content });
      setUndoSend({ ...queued, tempId, offline: true });
      setToast("Queued. Wavo will send it when you're back online.");
      return;
    }
    try {
      const sent = kind === "dm" ? await sendDmMessage(userId, targetId, content) : await sendSpaceMessage(targetId, userId, content);
      setMessages((prev) => prev.map((m) => m.id === tempId ? (sent || { ...optimistic, id: tempId }) : m));
      if (sent?.id) {
        setUndoSend({ kind, id: sent.id });
        setTimeout(() => setUndoSend((current) => current?.id === sent.id ? null : current), 5000);
      }
    } catch (err) { console.error(err); setMessages((prev) => prev.filter((m) => m.id !== tempId)); setMessageText(content); setToast(GENERIC_ERROR); }
  }

  async function undoLastSend() {
    const item = undoSend;
    if (!item) return;
    try {
      if (item.offline) { removeOutboxItem(userId, item.id); setMessages((prev) => prev.filter((m) => m.id !== item.tempId)); }
      else { if (item.kind === "dm") await deleteDmMessage(userId, item.id); else await deleteSpaceMessage(userId, item.id); setMessages((prev) => prev.filter((m) => m.id !== item.id)); }
      setUndoSend(null); setToast("Message undone");
    } catch { setToast(GENERIC_ERROR); }
  }

  async function toggleCurrentPin() {
    const current = chatToolTarget; if (!current) return;
    const kind = current.kind === "dm" ? "dm" : "space"; const id = String(current.target.id);
    const pinned = data.pins.some((p) => p.kind === kind && p.target_id === id);
    await setChatPinned(userId, kind, id, !pinned); await refresh(); setToast(pinned ? "Unpinned" : "Pinned");
  }

  async function saveCurrentNickname(value) {
    if (chatToolTarget?.kind !== "dm") return;
    await setNickname(userId, chatToolTarget.target.id, value); await refresh(); setToast("Nickname saved");
  }

  async function scheduleCurrentMessage(content, when) {
    if (chatToolTarget?.kind !== "dm") return;
    await scheduleDmMessage(userId, chatToolTarget.target.id, content, new Date(when).toISOString()); setToast("Message scheduled");
  }

  async function updatePrivacy(patch) {
    try { const privacy = await updatePrivacySettings(userId, patch); setData((prev) => ({ ...prev, privacy })); } catch (err) { console.error(err); setToast(GENERIC_ERROR); }
  }

  async function enableNotifications() {
    try {
      const allowed = await ensureNotificationPermission();
      if (!allowed) return setToast("Notifications are still off.");
      await subscribeToPush(userId);
      setToast("Notifications enabled");
    } catch (err) { console.error(err); setToast(GENERIC_ERROR); }
  }

  async function stopLocations() {
    await stopAllLocationSharing(userId);
    await refresh();
    setToast("Location sharing stopped");
  }

  if (booting) return <main className="splash"><div className="wavo-mark">W</div><span>Loading Wavo</span></main>;
  if (!session) return <AuthScreen onReady={setSession} />;

  const isDeepView = (tab === "inbox" && selectedFriend) || (tab === "spaces" && selectedSpace);

  const uxPrefs = getUxPrefs(userId);
  const currentToolPinned = chatToolTarget ? data.pins.some((p) => p.kind === (chatToolTarget.kind === "dm" ? "dm" : "space") && p.target_id === String(chatToolTarget.target.id)) : false;
  const currentToolMuted = chatToolTarget?.kind === "space" ? Boolean(uxPrefs.mutedSpaces?.[chatToolTarget.target.id]) : false;

  return (
    <main className="app-shell">
      <OfflineBanner online={online} queued={getOutbox(userId).length} />
      {!isDeepView && <Header profile={data.profile} pendingCount={data.requests.length} onBell={() => setTab("inbox")} onSearch={() => setSearchOpen(true)} />}
      <PullToRefresh onRefresh={refresh}><div className="app-content">
        {tab === "home" && <HomeScreen {...data} userId={userId} actions={actions} />}
        {tab === "spaces" && <SpacesScreen spaces={data.spaces} selectedSpace={selectedSpace} setSelectedSpace={setSelectedSpace} messages={messages} messageText={messageText} setMessageText={setMessageText} sendMessage={sendCurrentMessage} plans={data.plans} polls={data.polls} activities={data.activities} userId={userId} actions={actions} />}
        {tab === "inbox" && <InboxScreen friends={data.friends} requests={data.requests} selectedFriend={selectedFriend} setSelectedFriend={setSelectedFriend} messages={messages} messageText={messageText} setMessageText={setMessageText} sendMessage={sendCurrentMessage} userId={userId} actions={actions} nicknames={data.nicknames} />}
        {tab === "you" && <ProfileScreen profile={data.profile} posts={data.posts.filter((p) => p.author_id === userId)} userId={userId} onPostReact={actions.reactPost} onPostDelete={actions.deletePost} onNewPost={() => actions.openCreate("post")} privacy={data.privacy} locations={data.locations.filter((l) => l.owner_id === userId)} onPrivacy={updatePrivacy} onProfileSaved={refresh} onEnableNotifications={enableNotifications} onStopLocations={stopLocations} onLogout={() => supabase.auth.signOut()} />}
      </div></PullToRefresh>
      {!isDeepView && <BottomNav tab={tab} setTab={(next) => { setTab(next); if (next !== "spaces") setSelectedSpace(null); if (next !== "inbox") setSelectedFriend(null); }} openCreate={() => actions.openCreate()} />}
      {createMode && <CreateModal mode={createMode === true ? null : createMode} setMode={setCreateMode} spaces={data.spaces} friends={data.friends} presetSpace={presetSpace} onClose={() => { setCreateMode(false); setPresetSpace(null); }} onCreated={refresh} userId={userId} />}
      <Onboarding userId={userId} onCreateSpace={() => actions.openCreate("space")} onAddFriend={() => setTab("inbox")} />
      <UniversalSearch open={searchOpen} onClose={() => setSearchOpen(false)} data={data} messages={messages} onOpenFriend={actions.openFriend} onOpenSpace={actions.openSpace} onOpenTab={setTab} />
      <ChatTools open={Boolean(chatToolTarget)} onClose={() => setChatToolTarget(null)} target={chatToolTarget?.target} kind={chatToolTarget?.kind} messages={messages} pinned={currentToolPinned} nickname={chatToolTarget?.kind === "dm" ? data.nicknames[chatToolTarget.target.id] : ""} onTogglePin={toggleCurrentPin} onNickname={saveCurrentNickname} onSchedule={scheduleCurrentMessage} muted={currentToolMuted} onMute={() => { const id = chatToolTarget.target.id; const mutedSpaces = { ...(getUxPrefs(userId).mutedSpaces || {}), [id]: !currentToolMuted }; updateUxPrefs(userId, { mutedSpaces }); setToast(!currentToolMuted ? "Space muted" : "Space unmuted"); }} />
      {undoSend && <div className="undo-toast"><span>{undoSend.offline ? "Message queued" : "Message sent"}</span><button onClick={undoLastSend}>Undo</button></div>}
      <Toast message={toast} onClose={() => setToast("")} />
    </main>
  );
}
