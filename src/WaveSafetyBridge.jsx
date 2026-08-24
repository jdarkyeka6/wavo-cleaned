import { useEffect, useState } from "react";
import { Ban, Flag, X } from "lucide-react";
import { supabase } from "./supabaseClient";
import "./wave-safety.css";

const REASONS = [
  "Harassment or bullying",
  "Threats or violence",
  "Hate or discrimination",
  "Sexual or unsafe content",
  "Spam, scam or impersonation",
  "Something else",
];

export default function WaveSafetyBridge() {
  const [target, setTarget] = useState(null);
  const [reason, setReason] = useState(REASONS[0]);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function intercept(event) {
      const button = event.target?.closest?.('button[aria-label="More"]');
      const card = button?.closest?.(".waves-card");
      if (!button || !card) return;

      event.preventDefault();
      event.stopPropagation();
      const username = card.querySelector("header strong")?.textContent?.trim();
      if (!username) return;

      const body = card.querySelector(":scope > p")?.textContent?.trim() || "Media Wave";
      const { data } = await supabase
        .from("profiles")
        .select("id,username")
        .eq("username", username)
        .maybeSingle();
      if (data) {
        setTarget({ ...data, excerpt: body.slice(0, 300) });
        setReason(REASONS[0]);
        setDetails("");
        setMessage("");
      }
    }

    document.addEventListener("click", intercept, true);
    return () => document.removeEventListener("click", intercept, true);
  }, []);

  async function report() {
    if (!target || busy) return;
    setBusy(true);
    const context = target.excerpt ? ` Wave: ${target.excerpt}` : " Wave reported.";
    const extra = details.trim() ? ` Details: ${details.trim()}` : "";
    const { error } = await supabase.from("flags").insert({
      reporter_id: (await supabase.auth.getUser()).data.user?.id,
      reported_user_id: target.id,
      reason: `${reason}.${context}${extra}`.slice(0, 2000),
    });
    setBusy(false);
    if (error) return setMessage("Couldn’t send the report. Try again.");
    setMessage("Wave reported to Wavo moderation.");
  }

  async function block() {
    if (!target || busy) return;
    setBusy(true);
    const { error } = await supabase.rpc("block_user", { target: target.id });
    setBusy(false);
    if (error) return setMessage("Couldn’t block this person. Try again.");
    setMessage(`${target.username} is blocked. Reloading your Waves…`);
    window.setTimeout(() => window.location.reload(), 650);
  }

  if (!target) return null;

  return (
    <div className="wave-safety-backdrop" role="dialog" aria-modal="true" aria-label="Wave actions" onMouseDown={(e) => e.target === e.currentTarget && setTarget(null)}>
      <section className="wave-safety-card">
        <header><div><span>WAVE ACTIONS</span><strong>{target.username}</strong></div><button onClick={() => setTarget(null)} aria-label="Close"><X /></button></header>
        <div className="wave-safety-context">{target.excerpt}</div>
        <label>Why are you reporting this Wave?<select value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Extra details <small>Optional</small><textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1200} placeholder="Anything moderation should know" /></label>
        {message && <div className="wave-safety-message">{message}</div>}
        <div className="wave-safety-actions">
          <button className="wave-report" onClick={report} disabled={busy}><Flag /> Report Wave</button>
          <button className="wave-block" onClick={block} disabled={busy}><Ban /> Block {target.username}</button>
        </div>
      </section>
    </div>
  );
}
