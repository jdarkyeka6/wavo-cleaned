import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import {
  ArrowLeft,
  BarChart3,
  Users,
  Flag,
  Eye,
  ShieldCheck,
  Shield,
  Trash2,
  Search,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Minus,
  Megaphone,
  ScrollText,
} from "lucide-react";

export default function Admin({ me, onBack }) {
  const [tab, setTab] = useState("overview"); // overview | users | reports | viewer
  const [users, setUsers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [friendCount, setFriendCount] = useState(0);
  const [flags, setFlags] = useState([]);
  const [strikes, setStrikes] = useState([]);
  const [userSearch, setUserSearch] = useState("");

  const [viewerId, setViewerId] = useState("");
  const [viewerMessages, setViewerMessages] = useState([]);

  // "view as user" — read-only one-way mirror
  const [viewAs, setViewAs] = useState(null);
  const [vaFriends, setVaFriends] = useState([]);
  const [vaSelected, setVaSelected] = useState(null);
  const [vaMessages, setVaMessages] = useState([]);

  // batch 3: audit log + announcements
  const [auditLog, setAuditLog] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [announceText, setAnnounceText] = useState("");
  const [posting, setPosting] = useState(false);

  // --- LOAD ---
  useEffect(() => {
    loadUsers();
    loadMessages();
    loadFriendCount();
    loadFlags();
    loadStrikes();
    loadAudit();
    loadAnnouncements();

    const channel = supabase
      .channel("admin")
      .on("postgres_changes", { event: "*", schema: "public", table: "flags" }, loadFlags)
      .on("postgres_changes", { event: "*", schema: "public", table: "strikes" }, () => {
        loadStrikes();
        loadUsers();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, loadMessages)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  async function loadUsers() {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setUsers(data);
  }

  async function loadMessages() {
    const { data } = await supabase
      .from("messages")
      .select("id, sender_id, receiver_id, content, type, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (data) setMessages(data);
  }

  async function loadFriendCount() {
    const { count } = await supabase
      .from("friend_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "accepted");
    setFriendCount(count || 0);
  }

  async function loadStrikes() {
    const { data } = await supabase.from("strikes").select("*");
    if (data) setStrikes(data);
  }

  async function loadFlags() {
    const { data: rows } = await supabase
      .from("flags")
      .select("*")
      .order("created_at", { ascending: false });
    if (!rows) {
      setFlags([]);
      return;
    }
    const msgIds = rows.map((f) => f.message_id).filter(Boolean);
    const reporterIds = rows.map((f) => f.reporter_id).filter(Boolean);

    const [{ data: msgs }, { data: profs }] = await Promise.all([
      msgIds.length
        ? supabase.from("messages").select("id, content, type, sender_id").in("id", msgIds)
        : Promise.resolve({ data: [] }),
      reporterIds.length
        ? supabase.from("profiles").select("id, username").in("id", reporterIds)
        : Promise.resolve({ data: [] }),
    ]);

    const msgById = Object.fromEntries((msgs || []).map((m) => [m.id, m]));
    const nameMap = Object.fromEntries((profs || []).map((p) => [p.id, p.username]));

    setFlags(
      rows.map((f) => ({
        ...f,
        message: msgById[f.message_id] || null,
        reporter: nameMap[f.reporter_id] || "Unknown",
      }))
    );
  }

  async function loadViewer(id) {
    setViewerId(id);
    if (!id) {
      setViewerMessages([]);
      return;
    }
    const { data } = await supabase
      .from("messages")
      .select("*")
      .or(`sender_id.eq.${id},receiver_id.eq.${id}`)
      .order("created_at", { ascending: false })
      .limit(200);
    setViewerMessages(data || []);
  }

  // --- VIEW AS USER (read-only) ---
  async function openViewAs(user) {
    if (!user) return;
    setViewAs(user);
    setVaSelected(null);
    setVaMessages([]);
    const { data: rows } = await supabase
      .from("friend_requests")
      .select("sender_id, receiver_id")
      .eq("status", "accepted")
      .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`);
    const otherIds = (rows || []).map((r) =>
      r.sender_id === user.id ? r.receiver_id : r.sender_id
    );
    if (otherIds.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, username")
        .in("id", otherIds);
      setVaFriends(profs || []);
    } else {
      setVaFriends([]);
    }
  }

  async function openVaThread(friend) {
    setVaSelected(friend);
    const chatId = [viewAs.id, friend.id].sort().join("_");
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true });
    setVaMessages(data || []);
  }

  function closeViewAs() {
    setViewAs(null);
    setVaSelected(null);
    setVaMessages([]);
  }

  // --- AUDIT LOG + ANNOUNCEMENTS ---
  async function loadAudit() {
    const { data } = await supabase
      .from("admin_actions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (data) setAuditLog(data);
  }

  async function loadAnnouncements() {
    const { data } = await supabase
      .from("announcements")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (data) setAnnouncements(data);
  }

  async function logAction(action, targetUserId, detail) {
    await supabase.from("admin_actions").insert({
      actor_id: me.id,
      action,
      target_user_id: targetUserId || null,
      detail: detail || null,
    });
    loadAudit();
  }

  async function postAnnouncement() {
    const body = announceText.trim();
    if (!body) return;
    setPosting(true);
    const { error } = await supabase
      .from("announcements")
      .insert({ body, created_by: me.id });
    if (error) {
      alert(error.message);
    } else {
      setAnnounceText("");
      logAction("announce", null, body.slice(0, 80));
      loadAnnouncements();
    }
    setPosting(false);
  }

  async function deleteAnnouncement(id) {
    await supabase.from("announcements").delete().eq("id", id);
    loadAnnouncements();
  }

  // --- MODERATION ACTIONS ---
  async function issueStrike(userId) {
    if (!userId) return;
    const reason = window.prompt("Reason for this strike? (optional)");
    if (reason === null) return;
    const { error } = await supabase.from("strikes").insert({
      user_id: userId,
      reason: reason.trim() || null,
      issued_by: me.id,
    });
    if (error) {
      alert(error.message);
      return;
    }
    logAction("strike", userId, reason.trim() || null);
    loadStrikes();
    loadUsers();
  }

  async function removeStrike(userId) {
    if (!userId) return;
    // remove this user's most recent strike
    const theirs = strikes
      .filter((s) => s.user_id === userId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (theirs.length === 0) return;
    const { error } = await supabase.from("strikes").delete().eq("id", theirs[0].id);
    if (error) {
      alert(error.message);
      return;
    }
    logAction("remove_strike", userId, null);
    loadStrikes();
    loadUsers();
  }

  async function applyBan(userId, choice) {
    if (!userId) return;
    let banned_until;
    if (choice === "lift") banned_until = null;
    else if (choice === "permanent") banned_until = new Date("2999-01-01").toISOString();
    else banned_until = new Date(Date.now() + Number(choice) * 86400000).toISOString();
    await supabase.from("profiles").update({ banned_until }).eq("id", userId);
    logAction(
      choice === "lift" ? "unban" : "ban",
      userId,
      choice === "lift"
        ? null
        : choice === "permanent"
        ? "permanent"
        : `${choice} day(s)`
    );
    loadUsers();
  }

  async function toggleAdmin(u) {
    await supabase.from("profiles").update({ is_admin: !u.is_admin }).eq("id", u.id);
    logAction(u.is_admin ? "demote_admin" : "promote_admin", u.id, null);
    loadUsers();
  }

  async function deleteMessage(id) {
    await supabase.from("messages").delete().eq("id", id);
    logAction("delete_message", null, `message ${id.slice(0, 8)}`);
    loadMessages();
    loadFlags();
    if (viewerId) loadViewer(viewerId);
  }

  async function resolveFlag(id) {
    await supabase.from("flags").update({ resolved: true }).eq("id", id);
    loadFlags();
  }

  // --- DERIVED ---
  const userById = useMemo(
    () => Object.fromEntries(users.map((u) => [u.id, u])),
    [users]
  );
  const nameById = useMemo(
    () => Object.fromEntries(users.map((u) => [u.id, u.username])),
    [users]
  );
  const strikeCount = useMemo(() => {
    const m = {};
    strikes.forEach((s) => {
      m[s.user_id] = (m[s.user_id] || 0) + 1;
    });
    return m;
  }, [strikes]);
  const msgCountByUser = useMemo(() => {
    const m = {};
    messages.forEach((x) => {
      m[x.sender_id] = (m[x.sender_id] || 0) + 1;
    });
    return m;
  }, [messages]);

  const isBanned = (u) => u?.banned_until && new Date(u.banned_until) > new Date();
  const banText = (u) => {
    if (!isBanned(u)) return null;
    const until = new Date(u.banned_until);
    if (until.getFullYear() > 2900) return "Banned permanently";
    return "Banned until " + until.toLocaleString();
  };

  const openFlags = flags.filter((f) => !f.resolved);
  const bannedCount = users.filter(isBanned).length;
  const filteredUsers = users.filter((u) =>
    u.username?.toLowerCase().includes(userSearch.toLowerCase())
  );
  const fmt = (ts) => new Date(ts).toLocaleString();

  function modActions(userId) {
    const u = userById[userId];
    const banned = isBanned(u);
    const sc = strikeCount[userId] || 0;
    return (
      <div className="mod-actions">
        <button className="va-btn" onClick={() => openViewAs(u)} title="View as this user (read-only)">
          <Eye size={14} /> View as
        </button>
        <button className="strike-btn" onClick={() => issueStrike(userId)} title="Give a strike">
          <AlertTriangle size={14} /> Strike{sc ? ` (${sc})` : ""}
        </button>
        {sc > 0 && (
          <button
            className="unstrike-btn"
            onClick={() => removeStrike(userId)}
            title="Remove their most recent strike"
          >
            <Minus size={14} /> Strike
          </button>
        )}
        {banned ? (
          <button className="lift-btn" onClick={() => applyBan(userId, "lift")} title="Lift the ban">
            Unban
          </button>
        ) : (
          <select
            className="ban-select"
            defaultValue=""
            title="Ban for…"
            onChange={(e) => {
              const v = e.target.value;
              e.target.value = "";
              if (v) applyBan(userId, v);
            }}
          >
            <option value="">Ban…</option>
            <option value="3">3 days</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="permanent">Permanent</option>
          </select>
        )}
      </div>
    );
  }

  // --- VIEW AS PANEL ---
  if (viewAs) {
    return (
      <main className="admin-shell">
        <header className="admin-top">
          <button className="admin-back" onClick={closeViewAs}>
            <ArrowLeft size={16} /> Back to dashboard
          </button>
          <div className="admin-title">
            <Eye size={18} /> Viewing as {viewAs.username}
          </div>
          <div className="admin-me">{me?.username}</div>
        </header>

        <div className="viewas-banner">
          <Lock size={14} />
          Read-only — you're seeing Wavo exactly as <strong>{viewAs.username}</strong> sees it. You
          can look, but you can't send anything.
        </div>

        <div className="viewas-body">
          <div className="viewas-friends">
            <div className="viewas-friends-head">{viewAs.username}'s friends</div>
            {vaFriends.length === 0 && <div className="admin-empty">No friends.</div>}
            {vaFriends.map((f) => (
              <button
                key={f.id}
                className={`viewas-friend ${vaSelected?.id === f.id ? "active" : ""}`}
                onClick={() => openVaThread(f)}
              >
                <div className="admin-avatar sm">{(f.username?.[0] || "?").toUpperCase()}</div>
                {f.username}
              </button>
            ))}
          </div>
          <div className="viewas-thread">
            {!vaSelected && <div className="admin-empty">Pick a friend to read their chat.</div>}
            {vaSelected && vaMessages.length === 0 && (
              <div className="admin-empty">No messages in this chat yet.</div>
            )}
            {vaSelected &&
              vaMessages.map((m) => {
                const mine = m.sender_id === viewAs.id;
                return (
                  <div key={m.id} className={`va-bubble-wrap ${mine ? "mine" : "theirs"}`}>
                    <div className="va-bubble">
                      {m.type === "image" ? (
                        <img className="msg-image" src={m.content} alt="GIF" loading="lazy" />
                      ) : (
                        <p>{m.content}</p>
                      )}
                      <span className="va-time">{fmt(m.created_at)}</span>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <header className="admin-top">
        <button className="admin-back" onClick={onBack}>
          <ArrowLeft size={16} /> Back to Wavo
        </button>
        <div className="admin-title">
          <ShieldCheck size={18} /> Admin Dashboard
        </div>
        <div className="admin-me">{me?.username}</div>
      </header>

      <nav className="admin-tabs">
        <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>
          <BarChart3 size={15} /> Overview
        </button>
        <button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}>
          <Users size={15} /> Users
        </button>
        <button className={tab === "reports" ? "active" : ""} onClick={() => setTab("reports")}>
          <Flag size={15} /> Reports
          {openFlags.length > 0 && <span className="admin-pill">{openFlags.length}</span>}
        </button>
        <button className={tab === "viewer" ? "active" : ""} onClick={() => setTab("viewer")}>
          <Eye size={15} /> Viewer
        </button>
        <button className={tab === "announce" ? "active" : ""} onClick={() => setTab("announce")}>
          <Megaphone size={15} /> Announce
        </button>
        <button className={tab === "audit" ? "active" : ""} onClick={() => setTab("audit")}>
          <ScrollText size={15} /> Audit
        </button>
      </nav>

      <div className="admin-body">
        {tab === "overview" && (
          <div className="stat-grid">
            <div className="stat-card">
              <span className="stat-num">{users.length}</span>
              <span className="stat-label">Users</span>
            </div>
            <div className="stat-card">
              <span className="stat-num">{bannedCount}</span>
              <span className="stat-label">Currently banned</span>
            </div>
            <div className="stat-card">
              <span className="stat-num">{strikes.length}</span>
              <span className="stat-label">Strikes issued</span>
            </div>
            <div className="stat-card">
              <span className="stat-num">{messages.length}</span>
              <span className="stat-label">Messages (last 500)</span>
            </div>
            <div className="stat-card">
              <span className="stat-num">{friendCount}</span>
              <span className="stat-label">Friendships</span>
            </div>
            <div className="stat-card alert">
              <span className="stat-num">{openFlags.length}</span>
              <span className="stat-label">Open reports</span>
            </div>
          </div>
        )}

        {tab === "users" && (
          <>
            <div className="admin-search">
              <Search size={15} />
              <input
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Search users…"
              />
            </div>
            <div className="admin-table">
              {filteredUsers.map((u) => (
                <div key={u.id} className={`admin-row ${isBanned(u) ? "is-banned" : ""}`}>
                  <div className="admin-avatar">{(u.username?.[0] || "?").toUpperCase()}</div>
                  <div className="admin-row-main">
                    <strong>
                      {u.username}
                      {u.is_admin && <span className="role-tag">admin</span>}
                      {strikeCount[u.id] > 0 && (
                        <span className="role-tag strike">{strikeCount[u.id]}/3 strikes</span>
                      )}
                      {isBanned(u) && <span className="role-tag ban">banned</span>}
                    </strong>
                    <span>
                      {msgCountByUser[u.id] || 0} msgs · joined {fmt(u.created_at)}
                      {banText(u) ? ` · ${banText(u)}` : ""}
                    </span>
                    {(u.first_name || u.last_name || u.email || u.age) && (
                      <span className="admin-row-personal">
                        {[u.first_name, u.last_name].filter(Boolean).join(" ") ||
                          "—"}
                        {u.age ? ` · age ${u.age}` : ""}
                        {u.email ? (
                          <>
                            {" · "}
                            <a href={`mailto:${u.email}`}>{u.email}</a>
                          </>
                        ) : (
                          ""
                        )}
                      </span>
                    )}
                  </div>
                  <div className="admin-row-actions">
                    <button onClick={() => toggleAdmin(u)} title="Toggle admin">
                      {u.is_admin ? <Shield size={15} /> : <ShieldCheck size={15} />}
                    </button>
                    {modActions(u.id)}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === "reports" && (
          <div className="admin-table">
            {flags.length === 0 && <div className="admin-empty">No reports.</div>}
            {flags.map((f) => {
              const isUserReport = !!f.reported_user_id;
              const reportedUser = isUserReport ? userById[f.reported_user_id] : null;
              return (
                <div key={f.id} className={`flag-row ${f.resolved ? "done" : ""}`}>
                  <div className="flag-main">
                    <div className="flag-meta">
                      {isUserReport ? (
                        <>
                          <span className="flag-type">USER</span> Reported by{" "}
                          <strong>{f.reporter}</strong> · target{" "}
                          <strong>{nameById[f.reported_user_id] || "?"}</strong>
                        </>
                      ) : (
                        <>
                          <span className="flag-type msg">MSG</span> Reported by{" "}
                          <strong>{f.reporter}</strong>
                          {f.message && (
                            <> · sender <strong>{nameById[f.message.sender_id] || "?"}</strong></>
                          )}
                        </>
                      )}
                      {f.resolved && <span className="role-tag">resolved</span>}
                    </div>
                    {f.reason && <div className="flag-reason">“{f.reason}”</div>}
                    {!isUserReport && (
                      <div className="flag-content">
                        {f.message
                          ? f.message.type === "image"
                            ? "[GIF / image]"
                            : f.message.content
                          : "[message deleted]"}
                      </div>
                    )}
                    {isUserReport && reportedUser && (
                      <div className="flag-mod">{modActions(f.reported_user_id)}</div>
                    )}
                    {!isUserReport && f.message && (
                      <div className="flag-mod">{modActions(f.message.sender_id)}</div>
                    )}
                  </div>
                  <div className="flag-actions">
                    {!f.resolved && (
                      <button className="resolve" onClick={() => resolveFlag(f.id)} title="Mark resolved">
                        <CheckCircle2 size={15} />
                      </button>
                    )}
                    {!isUserReport && f.message && (
                      <button className="danger" onClick={() => deleteMessage(f.message.id)} title="Delete message">
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === "viewer" && (
          <>
            <div className="admin-search">
              <select value={viewerId} onChange={(e) => loadViewer(e.target.value)}>
                <option value="">Select a user to inspect…</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.username}
                  </option>
                ))}
              </select>
            </div>
            <div className="admin-table">
              {viewerId && viewerMessages.length === 0 && (
                <div className="admin-empty">No messages.</div>
              )}
              {viewerMessages.map((m) => (
                <div key={m.id} className="viewer-row">
                  <div className="viewer-main">
                    <span className="viewer-dir">
                      {m.sender_id === viewerId ? "→ to " : "← from "}
                      <strong>
                        {nameById[m.sender_id === viewerId ? m.receiver_id : m.sender_id] || "?"}
                      </strong>
                    </span>
                    <span className="viewer-text">
                      {m.type === "image" ? "[GIF / image]" : m.content}
                    </span>
                    <span className="viewer-time">{fmt(m.created_at)}</span>
                  </div>
                  <button className="danger" onClick={() => deleteMessage(m.id)} title="Delete message">
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === "announce" && (
          <div className="announce-tab">
            <div className="announce-compose">
              <h3>Post an announcement</h3>
              <p className="announce-hint">
                This shows as a banner to every user until they dismiss it.
              </p>
              <textarea
                value={announceText}
                onChange={(e) => setAnnounceText(e.target.value)}
                placeholder="Type your announcement…"
                rows={3}
                maxLength={280}
              />
              <button
                className="announce-post"
                onClick={postAnnouncement}
                disabled={posting || !announceText.trim()}
              >
                <Megaphone size={15} /> {posting ? "Posting…" : "Post to everyone"}
              </button>
            </div>
            <div className="admin-table">
              {announcements.length === 0 && (
                <div className="admin-empty">No announcements yet.</div>
              )}
              {announcements.map((a) => (
                <div key={a.id} className="announce-row">
                  <div className="announce-row-main">
                    <span className="announce-body">{a.body}</span>
                    <span className="announce-time">
                      {fmt(a.created_at)} · {nameById[a.created_by] || "?"}
                    </span>
                  </div>
                  <button
                    className="danger"
                    onClick={() => deleteAnnouncement(a.id)}
                    title="Delete announcement"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "audit" && (
          <div className="admin-table audit-tab">
            {auditLog.length === 0 && (
              <div className="admin-empty">No actions logged yet.</div>
            )}
            {auditLog.map((a) => (
              <div key={a.id} className="audit-row">
                <span className={`audit-action act-${a.action}`}>
                  {a.action.replace(/_/g, " ")}
                </span>
                <span className="audit-main">
                  <strong>{nameById[a.actor_id] || "?"}</strong>
                  {a.target_user_id && (
                    <>
                      {" → "}
                      <strong>{nameById[a.target_user_id] || "?"}</strong>
                    </>
                  )}
                  {a.detail && <span className="audit-detail">“{a.detail}”</span>}
                </span>
                <span className="audit-time">{fmt(a.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
