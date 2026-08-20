import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import { MapPin, CalendarDays, Check, X as XIcon, HelpCircle } from "lucide-react";

/**
 * A plan, rendered inside the conversation it was made in.
 *
 * The plan itself lives in `plans`; the message only carries its id. That way
 * a plan can change — the time moves, someone answers — without rewriting the
 * message, and the thread keeps its ordering for free.
 */

const RESPONSES = [
  { key: "going", label: "Going", Icon: Check },
  { key: "maybe", label: "Maybe", Icon: HelpCircle },
  { key: "out", label: "Can't", Icon: XIcon },
];

// "Today · 4:30 pm" reads faster than a date when the plan is imminent, which
// is when people are actually looking at it.
function whenLabel(iso, now = Date.now()) {
  if (!iso) return "";
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const startOf = (x) => new Date(x).setHours(0, 0, 0, 0);
  const days = Math.round((startOf(d) - startOf(now)) / 86400000);
  if (days === 0) return `Today · ${time}`;
  if (days === 1) return `Tomorrow · ${time}`;
  if (days === -1) return `Yesterday · ${time}`;
  const day = d.toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  return `${day} · ${time}`;
}

// Coordinates give an exact pin; a name or address can only be a search. The
// generated place_map_url covers the first case, so this handles the second.
function mapHref(plan) {
  if (plan.place_map_url) return plan.place_map_url;
  const q = [plan.place_name, plan.place_address].filter(Boolean).join(", ");
  if (!q) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

export default function PlanCard({ planId, userId, names = {}, mine }) {
  const [plan, setPlan] = useState(null);
  const [rsvps, setRsvps] = useState([]);
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState(false);

  // Bumped to force a refetch when an answer lands; the realtime handler below
  // sets it rather than calling the fetch directly, which keeps every write to
  // state inside the effect's own async scope.
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!planId) return;
    let cancelled = false;
    (async () => {
      const [{ data: p }, { data: r }] = await Promise.all([
        supabase.from("plans").select("*").eq("id", planId).maybeSingle(),
        supabase.from("plan_rsvps").select("*").eq("plan_id", planId),
      ]);
      if (cancelled) return;
      // A plan the reader can't see, or one deleted outright. Say so rather
      // than rendering an empty card that just looks broken.
      if (!p) setGone(true);
      else setPlan(p);
      setRsvps(r || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [planId, tick]);

  // Answers arrive while you're looking at the card — that liveness is the
  // point of putting the plan in the thread rather than behind a panel.
  useEffect(() => {
    if (!planId) return;
    const ch = supabase
      .channel(`plan:${planId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "plan_rsvps", filter: `plan_id=eq.${planId}` },
        refresh
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "plans", filter: `id=eq.${planId}` },
        refresh
      )
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [planId, refresh]);

  const mineNow = rsvps.find((r) => r.user_id === userId)?.response || null;

  const byResponse = useMemo(() => {
    const out = { going: [], maybe: [], out: [] };
    for (const r of rsvps) if (out[r.response]) out[r.response].push(r.user_id);
    return out;
  }, [rsvps]);

  async function answer(key) {
    if (busy || !plan || plan.cancelled) return;
    setBusy(true);
    // Optimistic: tapping your own answer should feel instant, and the realtime
    // round trip is the slowest part of it.
    const before = rsvps;
    const next = rsvps.filter((r) => r.user_id !== userId);
    if (key !== mineNow) next.push({ plan_id: planId, user_id: userId, response: key });
    setRsvps(next);

    const { error } =
      key === mineNow
        ? await supabase.from("plan_rsvps").delete().eq("plan_id", planId).eq("user_id", userId)
        : await supabase
            .from("plan_rsvps")
            .upsert({ plan_id: planId, user_id: userId, response: key }, { onConflict: "plan_id,user_id" });

    if (error) {
      setRsvps(before);
      alert(`Couldn't save that: ${error.message}`);
    }
    setBusy(false);
  }

  if (gone) {
    return <div className="plan-card plan-card-gone">This plan is no longer available.</div>;
  }
  if (!plan) return <div className="plan-card plan-card-loading">Loading plan…</div>;

  const href = mapHref(plan);
  const going = byResponse.going.map((id) => names[id]).filter(Boolean);

  return (
    <div className={`plan-card ${mine ? "mine" : ""} ${plan.cancelled ? "cancelled" : ""}`}>
      <div className="plan-card-head">
        <CalendarDays size={14} />
        <span className="plan-card-when">{whenLabel(plan.starts_at)}</span>
        {plan.cancelled && <span className="plan-card-off">Cancelled</span>}
      </div>

      <h4 className="plan-card-title">{plan.title}</h4>

      {(plan.place_name || plan.place_address || plan.location) && (
        <div className="plan-card-place">
          <MapPin size={13} />
          {href ? (
            <a href={href} target="_blank" rel="noreferrer">
              {plan.place_name || plan.place_address || plan.location}
            </a>
          ) : (
            <span>{plan.place_name || plan.place_address || plan.location}</span>
          )}
        </div>
      )}

      {plan.notes && <p className="plan-card-notes">{plan.notes}</p>}

      {!plan.cancelled && (
        <div className="plan-card-actions">
          {RESPONSES.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              className={`plan-rsvp ${mineNow === key ? "on" : ""}`}
              onClick={() => answer(key)}
              disabled={busy}
              // Tapping your current answer clears it, which is the only way
              // back to "haven't said" once you've said something.
              aria-pressed={mineNow === key}
            >
              <Icon size={13} />
              {label}
              {byResponse[key].length > 0 && (
                <span className="plan-rsvp-n">{byResponse[key].length}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {going.length > 0 && (
        <p className="plan-card-going">
          {going.slice(0, 3).join(", ")}
          {going.length > 3 && ` +${going.length - 3}`} going
        </p>
      )}
    </div>
  );
}
