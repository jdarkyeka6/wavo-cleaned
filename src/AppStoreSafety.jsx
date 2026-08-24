import { useEffect, useState } from "react";
import {
  Ban,
  ChevronLeft,
  LifeBuoy,
  Search,
  ShieldAlert,
  Trash2,
  UserRoundX,
  X,
} from "lucide-react";
import { supabase } from "./supabaseClient";
import "./app-store-safety.css";

const REPORT_REASONS = [
  "Harassment or bullying",
  "Threats or violence",
  "Hate or discrimination",
  "Sexual or unsafe content",
  "Spam, scam or impersonation",
  "Something else",
];

function initials(name) {
  return (name?.trim()?.[0] || "W").toUpperCase();
}

function MiniProfile({ profile }) {
  return (
    <>
      <span className="safety-avatar">
        {profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : initials(profile?.username)}
      </span>
      <span className="safety-person-copy">
        <strong>{profile?.username}</strong>
        <small>{profile?.status || "Wavo user"}</small>
      </span>
    </>
  );
}

export default function AppStoreSafety() {
  const [session, setSession] = useState(null);
  const [open, setOpen] = useState(false);
  const [screen, setScreen] = useState("home");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [blocked, setBlocked] = useState([]);
  const [selected, setSelected] = useState(null);
  const [reason, setReason] = useState(REPORT_REASONS[0]);
  const [details, setDetails] = useState("");
  const [supportCategory, setSupportCategory] = useState("support");
  const [supportMessage, setSupportMessage] = useState("");
  const [deleteText, setDeleteText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const userId = session?.user?.id;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session || null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) setOpen(false);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (userId) loadBlocked();
  }, [userId]);

  useEffect(() => {
    if (!open) {
      setScreen("home");
      setQuery("");
      setResults([]);
      setSelected(null);
      setDetails("");
      setDeleteText("");
      setNotice("");
    }
  }, [open]);

  async function loadBlocked() {
    const { data: rows, error } = await supabase
      .from("blocks")
      .select("blocked_id")
      .eq("blocker_id", userId);
    if (error || !rows?.length) {
      setBlocked([]);
      return;
    }
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id,username,avatar_url,status")
      .in("id", rows.map((row) => row.blocked_id));
    setBlocked(profiles || []);
  }

  async function searchPeople(event) {
    event?.preventDefault();
    const term = query.trim();
    if (term.length < 2 || !userId) return setResults([]);
    setBusy(true);
    setNotice("");
    const { data, error } = await supabase
      .from("profiles")
      .select("id,username,avatar_url,status")
      .ilike("username", `%${term}%`)
      .neq("id", userId)
      .limit(12);
    setBusy(false);
    if (error) setNotice("Search failed. Try again.");
    else setResults(data || []);
  }

  async function blockUser(profile) {
    if (!profile?.id) return;
    setBusy(true);
    setNotice("");
    const { error } = await supabase.rpc("block_user", { target: profile.id });
    if (!error) {
      await loadBlocked();
      setResults((prev) => prev.filter((item) => item.id !== profile.id));
      setNotice(`${profile.username} is blocked. They can’t friend or DM you.`);
    } else setNotice("Couldn’t block this person. Try again.");
    setBusy(false);
  }

  async function unblockUser(profile) {
    if (!profile?.id) return;
    setBusy(true);
    const { error } = await supabase.rpc("unblock_user", { target: profile.id });
    if (!error) {
      await loadBlocked();
      setNotice(`${profile.username} is unblocked.`);
    } else setNotice("Couldn’t unblock this person. Try again.");
    setBusy(false);
  }

  async function submitReport(event) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    const fullReason = details.trim() ? `${reason}: ${details.trim()}` : reason;
    const { error } = await supabase.from("flags").insert({
      reporter_id: userId,
      reported_user_id: selected.id,
      reason: fullReason.slice(0, 2000),
    });
    setBusy(false);
    if (error) return setNotice("Couldn’t send the report. Try again.");
    setNotice("Report sent to Wavo moderation.");
    setSelected(null);
    setDetails("");
  }

  async function submitSupport(event) {
    event.preventDefault();
    if (supportMessage.trim().length < 5) return;
    setBusy(true);
    const { error } = await supabase.from("support_requests").insert({
      user_id: userId,
      category: supportCategory,
      message: supportMessage.trim(),
    });
    setBusy(false);
    if (error) return setNotice("Couldn’t contact Wavo support. Try again.");
    setSupportMessage("");
    setNotice("Sent to Wavo support.");
  }

  async function deleteAccount() {
    if (deleteText !== "DELETE" || !userId) return;
    setBusy(true);
    setNotice("");
    const { error } = await supabase.functions.invoke("delete-account", {
      body: { confirmation: "DELETE" },
    });
    if (error) {
      setBusy(false);
      return setNotice("Account deletion failed. Your account was not deleted. Try again or contact support.");
    }

    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("wavo:") || key.startsWith("sb-")) localStorage.removeItem(key);
      }
    } catch {
      // The server deletion has already completed. Local cleanup is best effort.
    }
    await supabase.auth.signOut().catch(() => {});
    window.location.replace("/");
  }

  if (!session) return null;

  const openScreen = (next) => {
    setScreen(next);
    setQuery("");
    setResults([]);
    setSelected(null);
    setNotice("");
  };

  return (
    <>
      <button className="safety-launcher" onClick={() => setOpen(true)} aria-label="Safety and support">
        <ShieldAlert size={18} />
        <span>Safety</span>
      </button>

      {open && (
        <div className="safety-overlay" role="dialog" aria-modal="true" aria-label="Wavo Safety Centre">
          <section className="safety-sheet">
            <div className="safety-handle" />
            <header className="safety-head">
              {screen !== "home" ? (
                <button className="safety-icon-btn" onClick={() => openScreen("home")} aria-label="Back"><ChevronLeft /></button>
              ) : <span className="safety-head-spacer" />}
              <div><span>WAVO</span><strong>Safety Centre</strong></div>
              <button className="safety-icon-btn" onClick={() => setOpen(false)} aria-label="Close"><X /></button>
            </header>

            {notice && <button className="safety-notice" onClick={() => setNotice("")}>{notice}</button>}

            {screen === "home" && (
              <div className="safety-home">
                <div className="safety-intro"><ShieldAlert /><div><h2>You control who reaches you.</h2><p>Report unsafe behaviour, block someone instantly, contact Wavo, or manage your account.</p></div></div>
                <div className="safety-menu">
                  <button onClick={() => openScreen("report")}><ShieldAlert /><div><strong>Report someone</strong><span>Send a report to Wavo moderation</span></div></button>
                  <button onClick={() => openScreen("block")}><Ban /><div><strong>Block & unblock</strong><span>Stop unwanted friend requests and DMs</span></div></button>
                  <button onClick={() => openScreen("standards")}><UserRoundX /><div><strong>Community Standards</strong><span>What is and isn’t okay on Wavo</span></div></button>
                  <button onClick={() => openScreen("support")}><LifeBuoy /><div><strong>Contact Wavo</strong><span>Safety, privacy, account or app support</span></div></button>
                  <button className="danger-row" onClick={() => openScreen("delete")}><Trash2 /><div><strong>Delete account</strong><span>Permanently delete your account and associated data</span></div></button>
                </div>
              </div>
            )}

            {(screen === "report" || screen === "block") && (
              <div className="safety-page">
                <span className="safety-eyebrow">{screen === "report" ? "REPORT" : "BLOCK"}</span>
                <h2>{screen === "report" ? "Who do you want to report?" : "Block someone"}</h2>
                <form className="safety-search" onSubmit={searchPeople}>
                  <Search /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search username" autoCapitalize="none" autoCorrect="off" /><button disabled={busy || query.trim().length < 2}>Search</button>
                </form>
                <div className="safety-people-list">
                  {results.map((profile) => (
                    <button key={profile.id} onClick={() => screen === "report" ? setSelected(profile) : blockUser(profile)} disabled={busy}>
                      <MiniProfile profile={profile} /><span className="safety-person-action">{screen === "report" ? "Report" : "Block"}</span>
                    </button>
                  ))}
                </div>

                {screen === "block" && blocked.length > 0 && (
                  <div className="blocked-section"><span className="safety-eyebrow">BLOCKED</span>{blocked.map((profile) => (
                    <div className="blocked-row" key={profile.id}><MiniProfile profile={profile} /><button onClick={() => unblockUser(profile)} disabled={busy}>Unblock</button></div>
                  ))}</div>
                )}

                {screen === "report" && selected && (
                  <form className="report-card" onSubmit={submitReport}>
                    <div className="selected-person"><MiniProfile profile={selected} /></div>
                    <label>Reason<select value={reason} onChange={(e) => setReason(e.target.value)}>{REPORT_REASONS.map((item) => <option key={item}>{item}</option>)}</select></label>
                    <label>What happened? <span>Optional</span><textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1500} placeholder="Add details that will help moderation review it" /></label>
                    <div className="report-actions"><button type="button" onClick={() => setSelected(null)}>Cancel</button><button className="safety-primary" disabled={busy}>Send report</button></div>
                  </form>
                )}
              </div>
            )}

            {screen === "standards" && (
              <div className="safety-page standards-page">
                <span className="safety-eyebrow">COMMUNITY STANDARDS</span>
                <h2>Keep Wavo safe for your people.</h2>
                <p>Wavo is for conversations and sharing with people you choose. Harassment, credible threats, hate or discriminatory abuse, sexual exploitation, scams, impersonation, and repeated unwanted contact are not allowed.</p>
                <p>Do not share someone else’s private information or media without permission. Content that puts a child or teenager at risk is not allowed.</p>
                <p>If something crosses the line, report it. Wavo administrators can review reports and take action including removing content, strikes, temporary restrictions, or bans.</p>
                <button className="safety-primary" onClick={() => openScreen("report")}>Report a problem</button>
              </div>
            )}

            {screen === "support" && (
              <form className="safety-page support-page" onSubmit={submitSupport}>
                <span className="safety-eyebrow">CONTACT WAVO</span><h2>Send us a support request.</h2>
                <p>This goes directly into Wavo’s support queue with your account attached, so you don’t need to include private account details.</p>
                <label>What is this about?<select value={supportCategory} onChange={(e) => setSupportCategory(e.target.value)}><option value="support">App support</option><option value="safety">Safety</option><option value="privacy">Privacy</option><option value="account">Account</option></select></label>
                <label>Message<textarea required minLength={5} maxLength={4000} value={supportMessage} onChange={(e) => setSupportMessage(e.target.value)} placeholder="Tell us what you need help with" /></label>
                <button className="safety-primary" disabled={busy || supportMessage.trim().length < 5}>{busy ? "Sending…" : "Send to Wavo"}</button>
              </form>
            )}

            {screen === "delete" && (
              <div className="safety-page delete-page">
                <span className="safety-eyebrow danger">DELETE ACCOUNT</span><h2>This permanently deletes your Wavo account.</h2>
                <p>Your profile and associated Wavo data are deleted, including your posts, Waves, direct messages, memberships, reactions, plans, polls, location shares, and files you uploaded. This cannot be undone.</p>
                <label>Type <strong>DELETE</strong> to confirm<input value={deleteText} onChange={(e) => setDeleteText(e.target.value.toUpperCase())} autoCapitalize="characters" autoCorrect="off" /></label>
                <button className="delete-account-button" disabled={busy || deleteText !== "DELETE"} onClick={deleteAccount}><Trash2 /> {busy ? "Deleting…" : "Permanently delete account"}</button>
                <button className="safety-secondary" onClick={() => openScreen("support")}>Contact support instead</button>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
