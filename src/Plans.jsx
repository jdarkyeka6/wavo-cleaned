import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import { CalendarDays, ChevronDown, ChevronRight, MapPin } from "lucide-react";

/**
 * Plans — the thing people are already using Wavo for.
 * "Who's coming, where, when." One card, three buttons, live RSVPs.
 *
 * Row-level security does the gating: only group members can see or
 * create plans, and you can only RSVP as yourself. See the plans_and_rsvps
 * migration.
 */

const RESPONSES = [
  { key: "going", label: "Going" },
  { key: "maybe", label: "Maybe" },
  { key: "out", label: "Can't" },
];

function whenLabel(iso, now) {
  const d = new Date(iso);
  const days = Math.round((d.getTime() - now) / 86400000);

  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const day = d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });

  if (days === 0) return `Today · ${time}`;
  if (days === 1) return `Tomorrow · ${time}`;
  return `${day} · ${time}`;
}

// <input type="datetime-local"> speaks local time with no zone.
// Date() parses it as local, toISOString() converts to UTC. Correct as-is.
function toIso(local) {
  return local ? new Date(local).toISOString() : null;
}

export default function Plans({ group, userId, isAdmin }) {
  const [plans, setPlans] = useState([]);
  const [rsvps, setRsvps] = useState([]);
  const [names, setNames] = useState({});
  const [open, setOpen] = useState(true);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({ title: "", location: "", starts_at: "", notes: "" });

  const groupId = group?.id;

  const load = useCallback(async () => {
    if (!groupId) return;

    const { data: p } = await supabase
      .from("plans")
      .select("*")
      .eq("group_id", groupId)
      .eq("cancelled", false)
      .order("starts_at", { ascending: true });

    const list = p || [];
    setPlans(list);

    if (!list.length) {
      setRsvps([]);
      return;
    }

    const { data: r } = await supabase
      .from("plan_rsvps")
      .select("*")
      .in("plan_id", list.map((x) => x.id));
    setRsvps(r || []);

    // usernames for the "going" line
    const ids = [...new Set((r || []).map((x) => x.user_id))];
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, username")
        .in("id", ids);
      setNames(Object.fromEntries((profs || []).map((x) => [x.id, x.username])));
    }
  }, [groupId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  // live: someone else adds a plan or changes their RSVP
  useEffect(() => {
    if (!groupId) return;
    const ch = supabase
      .channel(`plans-${groupId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "plans", filter: `group_id=eq.${groupId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "plan_rsvps" }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [groupId, load]);

  // A ticking clock, so a plan rolls off on its own once it's been and gone.
  // Reading Date.now() during render would make this component impure.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const upcoming = useMemo(() => {
    const cutoff = now - 6 * 3600 * 1000; // keep showing for 6h after it starts
    return plans.filter((p) => new Date(p.starts_at).getTime() > cutoff);
  }, [plans, now]);

  async function createPlan() {
    if (!draft.title.trim() || !draft.starts_at) return;
    setSaving(true);
    const { error } = await supabase.from("plans").insert({
      group_id: groupId,
      created_by: userId,
      title: draft.title.trim(),
      location: draft.location.trim() || null,
      starts_at: toIso(draft.starts_at),
      notes: draft.notes.trim() || null,
    });
    setSaving(false);
    if (error) {
      alert("Couldn't create the plan: " + error.message);
      return;
    }
    setDraft({ title: "", location: "", starts_at: "", notes: "" });
    setCreating(false);
    load();
  }

  async function rsvp(planId, response) {
    const mine = rsvps.find((r) => r.plan_id === planId && r.user_id === userId);

    // tapping your current answer again clears it
    if (mine?.response === response) {
      setRsvps((prev) => prev.filter((r) => !(r.plan_id === planId && r.user_id === userId)));
      await supabase.from("plan_rsvps").delete().eq("plan_id", planId).eq("user_id", userId);
      return;
    }

    // optimistic — realtime will reconcile
    setRsvps((prev) => [
      ...prev.filter((r) => !(r.plan_id === planId && r.user_id === userId)),
      { plan_id: planId, user_id: userId, response },
    ]);

    const { error } = await supabase
      .from("plan_rsvps")
      .upsert({ plan_id: planId, user_id: userId, response }, { onConflict: "plan_id,user_id" });

    if (error) load(); // rollback to server truth
  }

  async function deletePlan(planId) {
    if (!window.confirm("Delete this plan?")) return;
    await supabase.from("plans").delete().eq("id", planId);
    load();
  }

  if (!group) return null;

  return (
    <div className="plans-wrap">
      <div className="plans-head" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <CalendarDays size={15} />
        <h5>Plans</h5>
        {upcoming.length > 0 && <span className="plans-count">{upcoming.length}</span>}
        <button
          className="plans-new-btn"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
            setCreating((c) => !c);
          }}
        >
          {creating ? "Close" : "+ New"}
        </button>
      </div>

      {open && (
        <div className="plans-body">
          {creating && (
            <div className="plan-form">
              <input
                placeholder="What's the plan?"
                maxLength={120}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
              <input
                type="datetime-local"
                value={draft.starts_at}
                onChange={(e) => setDraft({ ...draft, starts_at: e.target.value })}
              />
              <input
                placeholder="Where? (optional)"
                maxLength={200}
                value={draft.location}
                onChange={(e) => setDraft({ ...draft, location: e.target.value })}
              />
              <textarea
                placeholder="Anything else? (optional)"
                maxLength={500}
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
              <div className="plan-form-row">
                <button className="plan-cancel" onClick={() => setCreating(false)}>
                  Cancel
                </button>
                <button
                  className="plan-save"
                  disabled={saving || !draft.title.trim() || !draft.starts_at}
                  onClick={createPlan}
                >
                  {saving ? "Saving…" : "Post plan"}
                </button>
              </div>
            </div>
          )}

          {upcoming.length === 0 && !creating && (
            <p className="plans-empty">No plans yet. Hit + New to sort something out.</p>
          )}

          {upcoming.map((p) => {
            const mine = rsvps.find((r) => r.plan_id === p.id && r.user_id === userId);
            const going = rsvps.filter((r) => r.plan_id === p.id && r.response === "going");
            const past = new Date(p.starts_at).getTime() < now;

            return (
              <div key={p.id} className={`plan-card ${past ? "past" : ""}`}>
                <div className="plan-title">
                  {p.title}
                  {(p.created_by === userId || isAdmin) && (
                    <button className="plan-delete" onClick={() => deletePlan(p.id)}>
                      Delete
                    </button>
                  )}
                </div>

                <div className="plan-meta">
                  {whenLabel(p.starts_at, now)}
                  {p.location && (
                    <>
                      {" · "}
                      <MapPin size={11} style={{ verticalAlign: "-1px" }} /> {p.location}
                    </>
                  )}
                </div>

                {p.notes && <p className="plan-notes">{p.notes}</p>}

                <div className="plan-rsvp-row">
                  {RESPONSES.map((r) => (
                    <button
                      key={r.key}
                      className={`rsvp-btn ${mine?.response === r.key ? "on" : ""}`}
                      onClick={() => rsvp(p.id, r.key)}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>

                {going.length > 0 && (
                  <div className="plan-going">
                    {going.length} going ·{" "}
                    {going.map((g) => names[g.user_id] || "…").join(", ")}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
