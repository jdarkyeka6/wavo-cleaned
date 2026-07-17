import { useEffect, useMemo, useState } from "react";
import { Check, Star, X, GraduationCap } from "lucide-react";
import { useCosmeticCatalogue } from "./useCosmetics";

/**
 * Premium — $4.99/mo, or $3.49/mo for students.
 *
 * The student rate stays on the honour system — no verification,
 * deliberately: checking it would mean storing school email addresses
 * belonging to kids, a bigger liability than the $1.50 it would protect.
 *
 * Everything sold here is something OTHER people can see — badges and name
 * colours render from the server's copy of your profile, so they can't be
 * faked. The preview at the top is the whole pitch: this is how your
 * friends will see you.
 *
 * Props are unchanged from the old Premium, plus an OPTIONAL `username`
 * (falls back to "You") — pass profile?.username from App.jsx if you want
 * the preview to show their real name.
 */

// Fallback name colours if the cosmetics catalogue hasn't loaded yet.
const FALLBACK_STYLES = [
  { id: "coral", label: "Coral", color: "#FF6B5B" },
  { id: "aurora", label: "Aurora", color: "#63E6BE" },
  { id: "sunset", label: "Sunset", color: "#FF9E64" },
  { id: "gold", label: "Gold", color: "#FFC94D" },
];

const PERKS = [
  "Supporter star next to your name — everywhere",
  "Coloured name: coral, aurora, sunset or gold",
  "Aurora and Sunset themes",
  "You keep Wavo's lights on",
];

// Display only. The server decides the real price — this object never gets
// sent anywhere, it just draws the buttons.
const PRICES = {
  standard: 4.99,
  student: 3.49,
};

export default function Premium({
  open,
  onClose,
  onSubscribe,
  isPremium,
  busy,
  username = "You",
}) {
  const { list } = useCosmeticCatalogue();
  const [plan, setPlan] = useState("standard");
  const [styleIdx, setStyleIdx] = useState(0);

  const styles = useMemo(() => {
    const fromCatalogue = (list || [])
      .filter((c) => c.kind === "name_style" && c.payload?.color)
      .map((c) => ({ id: c.id, label: c.name || c.id, color: c.payload.color }));
    return fromCatalogue.length ? fromCatalogue : FALLBACK_STYLES;
  }, [list]);

  // Cycle the preview through the name colours — unless the person has
  // asked their device for reduced motion, in which case hold still.
  useEffect(() => {
    if (!open) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(
      () => setStyleIdx((i) => (i + 1) % styles.length),
      1800
    );
    return () => clearInterval(t);
  }, [open, styles.length]);

  if (!open) return null;

  const current = styles[styleIdx % styles.length];
  const price = PRICES[plan];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="new-group-card pm2-modal" onClick={(e) => e.stopPropagation()}>
        <style>{`
          .pm2-modal { max-width: 430px; width: 100%; padding: 1.5rem 1.5rem 1.3rem; max-height: 88vh; overflow-y: auto; position: relative; }

          .pm2-close {
            position: absolute; top: 0.9rem; right: 0.9rem;
            background: none; border: none; color: var(--text-dim);
            cursor: pointer; padding: 0.2rem; line-height: 0;
          }
          .pm2-close:hover { color: var(--text); }

          .pm2-head { text-align: center; margin-bottom: 1.1rem; }
          .pm2-head h2 {
            font-family: var(--display);
            font-size: 1.45rem;
            margin: 0.35rem 0 0.15rem;
            display: flex; align-items: center; justify-content: center; gap: 0.45rem;
          }
          .pm2-head p { color: var(--text-dim); margin: 0; font-size: 0.88rem; }

          .pm2-preview {
            background: var(--bg-deep);
            border: 1px solid var(--line);
            border-radius: 14px;
            padding: 0.9rem 1rem 1rem;
            margin-bottom: 1.1rem;
          }
          .pm2-preview-label {
            display: block;
            font-size: 0.7rem;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: var(--text-faint);
            margin-bottom: 0.6rem;
          }
          .pm2-bubble {
            display: flex; align-items: flex-start; gap: 0.6rem;
          }
          .pm2-avatar {
            width: 30px; height: 30px; border-radius: 50%;
            background: var(--panel-2);
            border: 2px solid currentColor;
            flex-shrink: 0;
            transition: border-color 500ms ease;
          }
          .pm2-msg { min-width: 0; }
          .pm2-name {
            font-weight: 700; font-size: 0.9rem;
            display: inline-flex; align-items: center; gap: 0.3rem;
            transition: color 500ms ease;
          }
          .pm2-name .pm2-star { color: var(--amber); }
          .pm2-text {
            background: var(--panel-2);
            border-radius: 4px 12px 12px 12px;
            padding: 0.45rem 0.7rem;
            margin-top: 0.25rem;
            font-size: 0.88rem;
            color: var(--text);
            width: fit-content;
          }
          .pm2-style-name {
            text-align: right;
            font-size: 0.72rem;
            color: var(--text-faint);
            margin-top: 0.45rem;
            transition: color 500ms ease;
          }

          .pm2-perks { list-style: none; padding: 0; margin: 0 0 1.15rem; }
          .pm2-perks li {
            display: flex; align-items: center; gap: 0.55rem;
            padding: 0.32rem 0;
            font-size: 0.88rem;
            color: var(--text);
          }
          .pm2-perks svg { color: var(--coral); flex-shrink: 0; }

          .pm2-plans { display: flex; gap: 0.6rem; margin-bottom: 1rem; }
          .pm2-plan {
            flex: 1;
            background: var(--panel-2);
            border: 1.5px solid var(--line);
            border-radius: 12px;
            padding: 0.75rem 0.8rem;
            cursor: pointer;
            text-align: left;
            color: var(--text);
            transition: border-color 150ms ease, background 150ms ease;
          }
          .pm2-plan:hover { border-color: var(--text-faint); }
          .pm2-plan:focus-visible { outline: 2px solid var(--coral); outline-offset: 2px; }
          .pm2-plan.on {
            border-color: var(--coral);
            background: var(--coral-soft);
          }
          .pm2-plan-name {
            font-weight: 700; font-size: 0.85rem;
            display: flex; align-items: center; gap: 0.35rem;
          }
          .pm2-plan-price { font-family: var(--display); font-size: 1.25rem; margin-top: 0.15rem; }
          .pm2-plan-price small { font-size: 0.72rem; color: var(--text-dim); font-family: var(--body); }
          .pm2-plan-note { font-size: 0.7rem; color: var(--text-faint); margin-top: 0.2rem; }

          .pm2-cta {
            width: 100%;
            background: var(--coral);
            color: var(--on-accent);
            border: none;
            border-radius: 12px;
            padding: 0.8rem;
            font-weight: 800;
            font-size: 0.95rem;
            cursor: pointer;
          }
          .pm2-cta:hover:not(:disabled) { filter: brightness(1.07); }
          .pm2-cta:disabled { opacity: 0.6; cursor: default; }
          .pm2-cta:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }

          .pm2-fineprint {
            text-align: center;
            color: var(--text-faint);
            font-size: 0.74rem;
            margin: 0.7rem 0 0;
          }
          .pm2-active {
            text-align: center;
            background: var(--coral-soft);
            border: 1px solid var(--coral);
            border-radius: 12px;
            padding: 0.9rem;
            font-weight: 600;
          }
        `}</style>

        <button className="pm2-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>

        <div className="pm2-head">
          <h2>
            <Star size={20} color="var(--amber)" /> Wavo Premium
          </h2>
          <p>Stand out in every chat.</p>
        </div>

        {/* The pitch IS the preview: this is you, as your friends see you. */}
        <div className="pm2-preview">
          <span className="pm2-preview-label">How friends will see you</span>
          <div className="pm2-bubble" style={{ color: current.color }}>
            <div className="pm2-avatar" />
            <div className="pm2-msg">
              <span className="pm2-name" style={{ color: current.color }}>
                {username}
                <Star size={12} className="pm2-star" fill="currentColor" />
              </span>
              <div className="pm2-text">see you at lunch? 🍕</div>
            </div>
          </div>
          <div className="pm2-style-name" style={{ color: current.color }}>
            {current.label}
          </div>
        </div>

        {isPremium ? (
          <div className="pm2-active">You're a Supporter. Thank you. ⭐</div>
        ) : (
          <>
            <ul className="pm2-perks">
              {PERKS.map((p) => (
                <li key={p}>
                  <Check size={14} /> {p}
                </li>
              ))}
            </ul>

            <div className="pm2-plans" role="radiogroup" aria-label="Choose a plan">
              <button
                type="button"
                role="radio"
                aria-checked={plan === "standard"}
                className={plan === "standard" ? "pm2-plan on" : "pm2-plan"}
                onClick={() => setPlan("standard")}
              >
                <span className="pm2-plan-name">
                  <Star size={13} /> Premium
                </span>
                <div className="pm2-plan-price">
                  ${PRICES.standard} <small>/ month</small>
                </div>
                <div className="pm2-plan-note">Cancel any time</div>
              </button>

              <button
                type="button"
                role="radio"
                aria-checked={plan === "student"}
                className={plan === "student" ? "pm2-plan on" : "pm2-plan"}
                onClick={() => setPlan("student")}
              >
                <span className="pm2-plan-name">
                  <GraduationCap size={14} /> Student
                </span>
                <div className="pm2-plan-price">
                  ${PRICES.student} <small>/ month</small>
                </div>
                <div className="pm2-plan-note">Honour system — we trust you</div>
              </button>
            </div>

            <button
              className="pm2-cta"
              onClick={() => onSubscribe(plan)}
              disabled={busy}
            >
              {busy ? "Opening…" : `Get Premium — $${price}/mo`}
            </button>

            <p className="pm2-fineprint">
              Ask a parent before you subscribe. Cancel any time.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
