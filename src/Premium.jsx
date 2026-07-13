import { Check, Star, X } from "lucide-react";
import { useCosmeticCatalogue } from "./useCosmetics";

/**
 * Premium.
 *
 * $2/mo. Everything sold here is something OTHER people can see — badges and
 * name colours render from the server's copy of your profile, so they can't
 * be faked. Themes are deliberately NOT the pitch: the CSS ships to every
 * browser, so a locked theme isn't really locked, and charging for one would
 * be charging for something a kid can take with devtools.
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

export default function Premium({ open, onClose, onSubscribe, isPremium, busy }) {
  const { list } = useCosmeticCatalogue();
  if (!open) return null;

  const nameStyles = list.filter((c) => c.kind === "name_style");

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal premium-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>

        <div className="premium-head">
          <Star size={22} />
          <h2>Wavo Premium</h2>
          <p>Two dollars a month. Keeps the lights on.</p>
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
              Premium <span className="premium-price">$2/mo</span>
            </h4>
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
            <button
              className="premium-cta"
              onClick={onSubscribe}
              disabled={busy}
            >
              {busy ? "Opening…" : "Get Premium — $2/mo"}
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
