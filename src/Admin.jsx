import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import {
  ArrowLeft,
  BarChart3,
  Users,
  Flag,
  Eye,
  Ban,
  ShieldCheck,
  Shield,
  Trash2,
  Search,
  CheckCircle2,
} from "lucide-react";

export default function Admin({ me, onBack }) {
  const [tab, setTab] = useState("overview"); // overview | users | reports | viewer
  const [users, setUsers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [friendCount, setFriendCount] = useState(0);
  const [flags, setFlags] = useState([]);
  const [userSearch, setUserSearch] = useState("");

  const [viewerId, setViewerId] = useState("");
  const [viewerMessages, setViewerMessages] = useState([]);

  // --- LOAD ---
  useEffect(() => {
    loadUsers();
    loadMessages();
    loadFriendCount();
    loadFlags();

    const channel = supabase
      .channel("admin")
      .on("postgres_changes", { event: "*", schema: "public", table: "flags" }, loadFlags)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => {
        loadMessages();
      })
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

  async function loadFlags() {
    const { data: rows } = await supabase
      .from("flags")
      .select("*")
      .order("created_at", { ascending: false });
    if (!rows) {
      setFlags([]);
      return;
    }
    // two-step hydrate: pull the flagged messages + reporter names
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
    const nameById = Object.fromEntries((profs || []).map((p) => [p.id, p.username]));

    setFlags(
      rows.map((f) => ({
        ...f,
        message: msgById[f.message_id] || null,
        reporter: nameById[f.reporter_id] || "Unknown",
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

  // --- ACTIONS ---
  async function toggleBan(u) {
    await supabase.from("profiles").update({ banned: !u.banned }).eq("id", u.id);
    loadUsers();
  }
  async function toggleAdmin(u) {
    await supabase.from("profiles").update({ is_admin: !u.is_admin }).eq("id", u.id);
    loadUsers();
  }
  async function deleteMessage(id) {
    await supabase.from("messages").delete().eq("id", id);
    loadMessages();
    loadFlags();
    if (viewerId) loadViewer(viewerId);
  }
  async function resolveFlag(id) {
    await supabase.from("flags").update({ resolved: true }).eq("id", id);
    loadFlags();
  }

  // --- DERIVED ---
  const nameById = useMemo(
    () => Object.fromEntries(users.map((u) => [u.id, u.username])),
    [users]
  );
  const openFlags = flags.filter((f) => !f.resolved);
  const filteredUsers = users.filter((u) =>
    u.username?.toLowerCase().includes(userSearch.toLowerCase())
  );
  const msgCountByUser = useMemo(() => {
    const m = {};
    messages.forEach((x) => {
      m[x.sender_id] = (m[x.sender_id] || 0) + 1;
    });
    return m;
  }, [messages]);

  const fmt = (ts) => new Date(ts).toLocaleString();

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
      </nav>

      <div className="admin-body">
        {tab === "overview" && (
          <div className="stat-grid">
            <div className="stat-card">
              <span className="stat-num">{users.length}</span>
              <span className="stat-label">Users</span>
            </div>
            <div className="stat-card">
              <span className="stat-num">{users.filter((u) => u.banned).length}</span>
              <span className="stat-label">Banned</span>
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
                <div key={u.id} className={`admin-row ${u.banned ? "is-banned" : ""}`}>
                  <div className="admin-avatar">{(u.username?.[0] || "?").toUpperCase()}</div>
                  <div className="admin-row-main">
                    <strong>
                      {u.username}
                      {u.is_admin && <span className="role-tag">admin</span>}
                      {u.banned && <span className="role-tag ban">banned</span>}
                    </strong>
                    <span>{msgCountByUser[u.id] || 0} msgs · joined {fmt(u.created_at)}</span>
                  </div>
                  <div className="admin-row-actions">
                    <button onClick={() => toggleAdmin(u)} title="Toggle admin">
                      {u.is_admin ? <Shield size={15} /> : <ShieldCheck size={15} />}
                    </button>
                    <button
                      className={u.banned ? "unban" : "ban"}
                      onClick={() => toggleBan(u)}
                      title={u.banned ? "Unban" : "Ban"}
                    >
                      <Ban size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === "reports" && (
          <div className="admin-table">
            {flags.length === 0 && <div className="admin-empty">No reports.</div>}
            {flags.map((f) => (
              <div key={f.id} className={`flag-row ${f.resolved ? "done" : ""}`}>
                <div className="flag-main">
                  <div className="flag-meta">
                    Reported by <strong>{f.reporter}</strong>
                    {f.message && <> · sender <strong>{nameById[f.message.sender_id] || "?"}</strong></>}
                    {f.resolved && <span className="role-tag">resolved</span>}
                  </div>
                  {f.reason && <div className="flag-reason">“{f.reason}”</div>}
                  <div className="flag-content">
                    {f.message
                      ? f.message.type === "image"
                        ? "[GIF / image]"
                        : f.message.content
                      : "[message deleted]"}
                  </div>
                </div>
                <div className="flag-actions">
                  {!f.resolved && (
                    <button className="resolve" onClick={() => resolveFlag(f.id)} title="Mark resolved">
                      <CheckCircle2 size={15} />
                    </button>
                  )}
                  {f.message && (
                    <button className="danger" onClick={() => deleteMessage(f.message.id)} title="Delete message">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            ))}
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
      </div>
    </main>
  );
}
