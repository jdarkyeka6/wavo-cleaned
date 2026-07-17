import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import { Flame, TrendingUp, TrendingDown, Minus, RefreshCw } from "lucide-react";

// Change this when you set your real Premium price (used for the revenue estimate)
const PREMIUM_PRICE_AUD = 4.99;

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: "1.4rem" }}>
      <h3
        style={{
          fontSize: "0.8rem",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--text-faint)",
          margin: "0 0 0.6rem 0",
        }}
      >
        {title}
      </h3>
      <div className="stat-grid">{children}</div>
    </div>
  );
}

function Stat({ num, label, alert }) {
  return (
    <div className={alert ? "stat-card alert" : "stat-card"}>
      <span className="stat-num">{num ?? 0}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

export default function FounderDashboard() {
  const [stats, setStats] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setErr("");
    const { data, error } = await supabase.rpc("get_founder_stats");
    if (error) setErr(error.message);
    else setStats(data);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <div style={{ padding: "2rem", color: "var(--text-faint)" }}>
        Loading founder stats…
      </div>
    );
  }
  if (err) {
    return (
      <div style={{ padding: "2rem", color: "var(--text-faint)" }}>
        Couldn't load stats: {err}
      </div>
    );
  }
  if (!stats) return null;

  const dau = stats.dau ?? 0;
  const dauYest = stats.dau_yesterday ?? 0;
  const delta = dau - dauYest;
  const conversion = stats.total_users
    ? ((stats.premium_users / stats.total_users) * 100).toFixed(1)
    : "0.0";
  const revenue = ((stats.premium_users ?? 0) * PREMIUM_PRICE_AUD).toFixed(2);

  const history = Array.isArray(stats.dau_history) ? stats.dau_history : [];
  const maxDau = Math.max(1, ...history.map((h) => h.count));

  const DeltaIcon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const deltaColor = delta > 0 ? "#4ade80" : delta < 0 ? "#f87171" : "var(--text-faint)";
  const verdict =
    delta > 0
      ? "Wavo is healthier than yesterday 🟢"
      : delta < 0
      ? "Wavo is less active than yesterday 🔴"
      : "Wavo is holding steady 🟡";

  return (
    <div>
      {/* ===== Hero: the one number that matters ===== */}
      <div
        style={{
          border: "1px solid var(--coral)",
          borderRadius: "14px",
          padding: "1.2rem 1.4rem",
          marginBottom: "1.4rem",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "1.4rem",
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "0.6rem",
            }}
          >
            <Flame size={26} color="var(--coral)" />
            <span style={{ fontSize: "2.6rem", fontWeight: 800, lineHeight: 1 }}>
              {dau}
            </span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.25rem",
                color: deltaColor,
                fontWeight: 700,
                fontSize: "0.95rem",
              }}
            >
              <DeltaIcon size={16} />
              {delta > 0 ? `+${delta}` : delta} vs yesterday
            </span>
          </div>
          <div style={{ color: "var(--text-faint)", marginTop: "0.2rem" }}>
            Daily Active Users
          </div>
          <div style={{ marginTop: "0.5rem", fontWeight: 600 }}>{verdict}</div>
        </div>

        {/* 14-day sparkline */}
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: "3px",
              height: "48px",
            }}
            title="Daily active users, last 14 days"
          >
            {history.map((h) => (
              <div
                key={h.day}
                title={`${h.day}: ${h.count}`}
                style={{
                  width: "10px",
                  height: `${Math.max(3, (h.count / maxDau) * 48)}px`,
                  borderRadius: "3px 3px 0 0",
                  background:
                    h.count > 0 ? "var(--coral)" : "rgba(255,255,255,0.12)",
                }}
              />
            ))}
          </div>
          <div style={{ color: "var(--text-faint)", fontSize: "0.72rem", marginTop: "0.3rem" }}>
            last 14 days
          </div>
        </div>

        <button
          onClick={load}
          title="Refresh stats"
          style={{
            background: "none",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: "8px",
            color: "var(--text-faint)",
            padding: "0.4rem 0.55rem",
            cursor: "pointer",
          }}
        >
          <RefreshCw size={15} />
        </button>
      </div>

      {/* ===== Sections ===== */}
      <Section title="📈 Activity">
        <Stat num={dau} label="Daily active" />
        <Stat num={stats.wau} label="Weekly active" />
        <Stat num={stats.mau} label="Monthly active" />
        <Stat num={stats.new_users_today} label="New users today" />
        <Stat num={stats.new_users_week} label="New users this week" />
        <Stat num={stats.total_users} label="Total users" />
      </Section>

      <Section title="💬 Messaging">
        <Stat num={stats.messages_today} label="Messages today" />
        <Stat num={stats.messages_yesterday} label="Messages yesterday" />
        <Stat num={stats.avg_messages_7d} label="7-day average / day" />
        <Stat num={stats.senders_today} label="People who sent today" />
        <Stat num={stats.most_active_group || "—"} label="Most active group (7d)" />
        <Stat num={stats.total_messages} label="All-time messages" />
      </Section>

      <Section title="👥 Groups">
        <Stat num={stats.groups_total} label="Groups created" />
        <Stat num={stats.active_groups_7d} label="Active groups (7d)" />
        <Stat num={stats.plans_week} label="Plans created (7d)" />
        <Stat num={stats.games_week} label="Games played (7d)" />
      </Section>

      <Section title="🚪 Retention">
        <Stat num={stats.new_users_week} label="New users (7d)" />
        <Stat
          num={stats.inactive_7d}
          label="Haven't opened Wavo in 7+ days"
          alert={(stats.inactive_7d ?? 0) > 0}
        />
      </Section>

      <Section title="⭐ Premium">
        <Stat num={stats.premium_users} label="Premium users" />
        <Stat num={`${conversion}%`} label="Conversion rate" />
        <Stat num={`$${revenue}`} label={`Est. revenue (@ $${PREMIUM_PRICE_AUD} AUD)`} />
      </Section>

      <p style={{ color: "var(--text-faint)", fontSize: "0.78rem" }}>
        DAU history starts recording from today — the sparkline fills in as days pass.
        Activity is tracked whenever someone opens Wavo.
      </p>
    </div>
  );
}
