import { useState } from "react";
import { Check, Star, X } from "lucide-react";
import { useCosmeticCatalogue } from "./useCosmetics";

/**
 * Premium.
 *
 * $5/mo standard, $3/mo student, or pay yearly for two months free
 * ($40/yr standard, $25/yr student). The student rate is on the honour
 * system — no verification, deliberately: checking it would mean storing
 * school email addresses belonging to kids, a bigger liability than the
 * $2 it would protect.
 *
 * Everything sold here is something OTHER people can see — badges and name
 * colours render from the server's copy of your profile, so they can't be
 * faked. Themes are deliberately NOT the pitch: the CSS ships to every
 * browser, so a locked theme isn't really locked.
 */

const FREE = [
  "Unlimited chat, groups and DMs",
  "All 10 games",
  "Plans and RSVPs",
  "7 themes, plus 3 more you can earn",
  "Badges you earn by turning up",
];

const PREMIUM = [
  "The Supporter badge, next to your name",
  "Coloured name — coral, aurora, sunset or gold",
  "Aurora and Sunset themes",
  "Everything in Free, obviously",
];

// Prices live here only for display. The server decides the real price —
// this object never gets sent anywhere, it just draws the buttons.
const PRICES = {
  standard: { monthly: 5, yearly: 50 },
  student: { monthly: 3, yearly: 30 },
};

export default function Premium({ open, onClose, onSubscribe, isPremium, busy }) {
  const { list } = useCosmeticCatalogue();
  const [student, setStudent] = useState(true);
  const [yearly, setYearly] = useState(false);

  if (!open) return null;

  const nameStyles = list.filter((c) => c.kind === "name_style");
  const tier = student ? "student" : "standard";
  const price = yearly ? PRICES[tier].yearly : PRICES[tier].monthly;
  const period = yearly ? "yr" : "mo";
  const plan = yearly ? `${tier}_annual` : tier;
  const monthlyEquivalent = yearly ? (PRICES[tier].yearly / 12).toFixed(2) : null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal premium-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>

        <div className="premium-head">
          <Star size={22} />
          <h2>Wavo Premium</h2>
          <p>Keeps the lights on. Cancel any time.</p>
        </div>

        {/* Show the thing, don't describe it */}
        <div className="premium-demo">
          <span className="premium-demo-label">What people see:</span>
          <div className="premium-demo-names">
            {nameStyles.map((s) => (
              <span key={s.id} className="premium-demo-name">
                <span style={{ color: s.payload?.color }}>Jake</span>
                <span className="user-badge" style={{ color: "#FFB454" }}>
                  ⭐
                </span>
              </span>
            ))}
          </div>
        </div>

        <div className="premium-cols">
          <div className="premium-col">
            <h4>Free</h4>
            <ul>
              {FREE.map((f) => (
                <li key={f}>
                  <Check size={13} /> {f}
                </li>
              ))}
            </ul>
          </div>

          <div className="premium-col paid">
            <h4>
              Premium{" "}
              <span className="premium-price">
                {student && <s className="premium-price-was">${yearly ? 50 : 5}</s>} $
                {price}/{period}
              </span>
            </h4>
            {yearly && (
              <p className="premium-yearly-note">
                works out to ${monthlyEquivalent}/mo — 2 months free
              </p>
            )}
            <ul>
              {PREMIUM.map((f) => (
                <li key={f}>
                  <Check size={13} /> {f}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {isPremium ? (
          <div className="premium-active">You're a Supporter. Thank you.</div>
        ) : (
          <>
            <div className="premium-toggles">
              <label className="premium-student">
                <input
                  type="checkbox"
                  checked={student}
                  onChange={(e) => setStudent(e.target.checked)}
                />
                <span>
                  I'm a student <strong>— $2 off</strong>
                </span>
              </label>

              <div className="premium-billing-switch">
                <button
                  type="button"
                  className={!yearly ? "active" : ""}
                  onClick={() => setYearly(false)}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  className={yearly ? "active" : ""}
                  onClick={() => setYearly(true)}
                >
                  Yearly <span className="save-badge">2 months free</span>
                </button>
              </div>
            </div>

            <button
              className="premium-cta"
              onClick={() => onSubscribe(plan)}
              disabled={busy}
            >
              {busy ? "Opening…" : `Get Premium — $${price}/${period}`}
            </button>

            <p className="premium-fineprint">
              Ask a parent before you subscribe. Cancel any time.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
