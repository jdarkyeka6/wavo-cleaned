import { useMemo, useState } from "react";
import { X, Clock, Trash2 } from "lucide-react";

/** Local datetime in the shape <input type="datetime-local"> expects. */
function toLocalInput(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/**
 * Presets, computed against the user's own clock rather than UTC — "tomorrow
 * morning" has to mean their tomorrow.
 */
function presets(now) {
  const inAnHour = new Date(now.getTime() + 60 * 60 * 1000);

  const tonight = new Date(now);
  tonight.setHours(20, 0, 0, 0);

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);

  const nextWeek = new Date(now);
  nextWeek.setDate(nextWeek.getDate() + 7);
  nextWeek.setHours(9, 0, 0, 0);

  return [
    { label: "In an hour", at: inAnHour },
    // Past 8pm this would be in the past, so it drops out rather than showing
    // an option that gets rejected.
    ...(tonight > now ? [{ label: "Tonight, 8pm", at: tonight }] : []),
    { label: "Tomorrow, 9am", at: tomorrow },
    { label: "Next week", at: nextWeek },
  ];
}

export function SendLaterDialog({ text, pending, onSchedule, onCancel, onClose }) {
  const now = useMemo(() => new Date(), []);
  const [custom, setCustom] = useState(() =>
    toLocalInput(new Date(now.getTime() + 60 * 60 * 1000))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const trimmed = (text || "").trim();

  async function send(at) {
    if (!trimmed) {
      setError("Type a message first.");
      return;
    }
    if (!(at instanceof Date) || Number.isNaN(at.getTime())) {
      setError("That isn't a valid date and time.");
      return;
    }
    if (at <= new Date()) {
      setError("Pick a time in the future.");
      return;
    }
    setBusy(true);
    setError("");
    const err = await onSchedule(trimmed, at);
    setBusy(false);
    if (err) setError(err);
    else onClose();
  }

  return (
    <div className="social-overlay" onClick={onClose}>
      <div
        className="send-later-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Send later"
      >
        <header>
          <div>
            <Clock size={17} />
            <h3>Send later</h3>
          </div>
          <button className="social-close inline" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        {trimmed ? (
          <p className="send-later-preview">“{trimmed}”</p>
        ) : (
          <p className="send-later-empty">
            Type your message in the box first, then choose when it goes.
          </p>
        )}

        <div className="send-later-presets">
          {presets(now).map((p) => (
            <button key={p.label} disabled={busy || !trimmed} onClick={() => send(p.at)}>
              <strong>{p.label}</strong>
              <span>
                {p.at.toLocaleString([], {
                  weekday: "short",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            </button>
          ))}
        </div>

        <label className="send-later-custom">
          <span>Or pick a time</span>
          <div>
            <input
              type="datetime-local"
              value={custom}
              min={toLocalInput(now)}
              onChange={(e) => setCustom(e.target.value)}
            />
            <button
              className="social-primary"
              disabled={busy || !trimmed}
              onClick={() => send(new Date(custom))}
            >
              Schedule
            </button>
          </div>
        </label>

        {error && <p className="send-later-error">{error}</p>}

        {pending.length > 0 && (
          <div className="send-later-pending">
            <h4>Waiting to send</h4>
            {pending.map((s) => (
              <div className="send-later-row" key={s.id}>
                <div>
                  <strong>{s.content}</strong>
                  <span>{new Date(s.send_at).toLocaleString()}</span>
                </div>
                <button
                  onClick={() => onCancel(s.id)}
                  title="Cancel this message"
                  aria-label={`Cancel scheduled message: ${s.content}`}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}

        <p className="send-later-note">
          Scheduled messages go out the next time Wavo is used at or after that
          time — usually within a minute, but not to the second.
        </p>
      </div>
    </div>
  );
}
