import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import { Bot, RefreshCw, ShieldAlert, UserRound, UserPlus, CheckCircle2 } from "lucide-react";

function deviceLabel(userAgent = "") {
  if (/iphone|ipad|ipod/i.test(userAgent)) return "Apple mobile";
  if (/android/i.test(userAgent)) return "Android";
  if (/windows/i.test(userAgent)) return "Windows";
  if (/macintosh|mac os/i.test(userAgent)) return "Mac";
  if (/linux/i.test(userAgent)) return "Linux";
  return userAgent ? "Other device" : "Not supplied";
}

export default function SignupIntelligence() {
  const [rows, setRows] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [botType, setBotType] = useState("official_bot");
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    const { data, error: queryError } = await supabase
      .from("signup_intelligence")
      .select("user_id,signup_source,referrer_host,utm_source,utm_medium,utm_campaign,landing_path,user_agent,email_verified_at,automation_signals,created_at")
      .order("created_at", { ascending: false })
      .limit(300);
    if (queryError) {
      setError(queryError.message);
      setRows([]);
      setLoading(false);
      return;
    }
    const items = data || [];
    setRows(items);
    const ids = items.map((item) => item.user_id);
    if (ids.length) {
      const { data: profileRows, error: profileError } = await supabase
        .from("profiles")
        .select("id,username,account_type,is_internal")
        .in("id", ids);
      if (profileError) setError(profileError.message);
      setProfiles(Object.fromEntries((profileRows || []).map((p) => [p.id, p])));
    } else {
      setProfiles({});
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const counts = useMemo(() => ({
    total: rows.length,
    unverified: rows.filter((row) => !row.email_verified_at).length,
    bots: rows.filter((row) => ["official_bot", "integration_bot"].includes(profiles[row.user_id]?.account_type)).length,
    internal: rows.filter((row) => profiles[row.user_id]?.is_internal).length,
    unknown: rows.filter((row) => !row.signup_source || row.signup_source === "unknown").length,
  }), [rows, profiles]);

  async function createBot(event) {
    event.preventDefault();
    setCreating(true);
    setNotice("");
    const { data, error: invokeError } = await supabase.functions.invoke("admin-create-bot", {
      body: {
        username: username.trim().toLowerCase(),
        displayName: displayName.trim(),
        description: description.trim(),
        accountType: botType,
      },
    });
    if (invokeError || !data?.ok) {
      setNotice(data?.error || invokeError?.message || "Bot account could not be created.");
    } else {
      setNotice(`Created @${data.username} as ${botType.replace("_", " ")}.`);
      setUsername("");
      setDisplayName("");
      setDescription("");
      await load();
    }
    setCreating(false);
  }

  return (
    <section className="signup-intelligence">
      <div className="signup-intel-head">
        <div><h2>Signup intelligence</h2><p>Referral attribution, verification and approved bot accounts. No raw IP addresses are collected.</p></div>
        <button type="button" onClick={load} disabled={loading}><RefreshCw size={15}/> Refresh</button>
      </div>
      <div className="signup-intel-stats">
        <div><strong>{counts.total}</strong><span>Tracked signups</span></div>
        <div><strong>{counts.unverified}</strong><span>Email not verified</span></div>
        <div><strong>{counts.bots}</strong><span>Approved bots</span></div>
        <div><strong>{counts.unknown}</strong><span>Unknown source</span></div>
      </div>
      <div className="signup-intel-note"><ShieldAlert size={16}/> These are investigation signals, not proof that an account is a bot. Unverified email or missing referral data never triggers an automatic ban.</div>
      {error && <p className="signup-intel-error">{error}</p>}
      <div className="signup-intel-table">
        <div className="signup-intel-row signup-intel-labels"><span>Account</span><span>Source</span><span>Signup details</span><span>Status</span></div>
        {loading && <div className="signup-intel-empty">Loading signup records…</div>}
        {!loading && rows.length === 0 && <div className="signup-intel-empty">No tracked signups yet. New registrations will appear here.</div>}
        {rows.map((row) => {
          const profile = profiles[row.user_id] || {};
          const isBot = ["official_bot", "integration_bot"].includes(profile.account_type);
          const source = row.utm_source ? `${row.signup_source} · ${row.utm_source}` : row.signup_source;
          return <div className="signup-intel-row" key={row.user_id}>
            <span><strong>@{profile.username || "unknown"}</strong><small>{new Date(row.created_at).toLocaleString()}</small></span>
            <span>{source || "unknown"}{row.referrer_host && <small>from {row.referrer_host}</small>}{row.utm_campaign && <small>campaign: {row.utm_campaign}</small>}</span>
            <span>{row.utm_medium || "no medium"}<small>{row.landing_path || "landing path unavailable"} · {deviceLabel(row.user_agent)}</small></span>
            <span className="signup-intel-tags">
              {isBot ? <em className="bot"> <Bot size={12}/> {profile.account_type.replace("_", " ")} </em> : <em className="human"><UserRound size={12}/> human account</em>}
              {profile.is_internal && !isBot && <em className="pending">internal / test</em>}
              {row.email_verified_at ? <em className="verified"><CheckCircle2 size={12}/> verified</em> : <em className="pending">email pending</em>}
              {row.automation_signals?.filter((s) => s !== "approved_bot_account").map((signal) => <small key={signal}>{signal.replaceAll("_", " ")}</small>)}
            </span>
          </div>;
        })}
      </div>
      <form className="signup-intel-bot-form" onSubmit={createBot}>
        <div><h3><Bot size={17}/> Create an approved bot account</h3><p>Only admins can create these. Bots are visibly labelled and are not counted as human signups.</p></div>
        <div className="signup-intel-form-grid">
          <label>Bot username<input value={username} onChange={(e) => setUsername(e.target.value)} minLength={3} maxLength={24} pattern="[a-zA-Z0-9_]+" required placeholder="wavo_helper"/></label>
          <label>Display name<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={50} required placeholder="Wavo Helper"/></label>
          <label>Bot type<select value={botType} onChange={(e) => setBotType(e.target.value)}><option value="official_bot">Official bot</option><option value="integration_bot">Integration bot</option></select></label>
          <label>Description<input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={160} placeholder="What this bot does"/></label>
        </div>
        <button type="submit" disabled={creating}><UserPlus size={15}/> {creating ? "Creating…" : "Create bot account"}</button>
        {notice && <p role="status">{notice}</p>}
      </form>
    </section>
  );
}
