import { useEffect, useMemo, useState } from "react";
import { X, CalendarDays } from "lucide-react";

/**
 * Making a plan.
 *
 * Title and time are required because a plan without either is just a message.
 * Everything else is optional — the common case is "Maccas, 4pm", and asking
 * for an address before someone can ask their friends if they're coming would
 * kill the feature.
 */

// <input type="datetime-local"> wants local wall-clock with no zone, so the
// default has to be built from local parts rather than sliced off an ISO
// string, which would be UTC and land hours out.
function localValue(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

// Default to the next round half hour rather than "now", which is never when
// anyone is meeting.
function defaultWhen() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(d.getMinutes() > 30 ? 60 : 30, 0, 0);
  return localValue(d);
}

export default function NewPlanDialog({ onClose, onCreate, where }) {
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState(defaultWhen);
  const [place, setPlace] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // No reset effect: the caller mounts this only while it is open, so every
  // opening is a fresh mount and the initial state above is the reset.
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ready = useMemo(
    () => title.trim().length > 0 && !!when && !Number.isNaN(new Date(when).getTime()),
    [title, when]
  );

  async function submit(e) {
    e?.preventDefault();
    if (!ready || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onCreate({
        title: title.trim(),
        // Date() reads the field as local time and toISOString converts to UTC,
        // which is what the column stores.
        starts_at: new Date(when).toISOString(),
        place_name: place.trim() || null,
        place_address: address.trim() || null,
        notes: notes.trim() || null,
      });
      onClose?.();
    } catch (err) {
      setError(err?.message || "Couldn't make that plan.");
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <form className="modal plan-dialog" onSubmit={submit}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>

        <h3 className="plan-dialog-title">
          <CalendarDays size={16} /> Make a plan
        </h3>
        {where && <p className="plan-dialog-where">in {where}</p>}

        <label className="settings-label" htmlFor="plan-title">What</label>
        <input
          id="plan-title"
          className="settings-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Maccas run"
          maxLength={120}
          autoFocus
        />

        <label className="settings-label" htmlFor="plan-when">When</label>
        <input
          id="plan-when"
          className="settings-input auth-date"
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />

        <label className="settings-label" htmlFor="plan-place">Where <span className="plan-optional">optional</span></label>
        <input
          id="plan-place"
          className="settings-input"
          value={place}
          onChange={(e) => setPlace(e.target.value)}
          placeholder="The one near school"
          maxLength={120}
        />
        <input
          className="settings-input"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Address, so it opens in Maps"
          maxLength={300}
        />

        <label className="settings-label" htmlFor="plan-notes">Notes <span className="plan-optional">optional</span></label>
        <input
          id="plan-notes"
          className="settings-input"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="bring cash"
          maxLength={300}
        />

        {error && <p className="crop-error">{error}</p>}

        <div className="crop-actions">
          <button type="button" className="mini-btn ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="mini-btn" disabled={!ready || saving}>
            {saving ? "Sending…" : "Send plan"}
          </button>
        </div>
      </form>
    </div>
  );
}
