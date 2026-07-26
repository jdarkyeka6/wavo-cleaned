import { useState } from "react";
import { Check, Star, X } from "lucide-react";
import { useCosmeticCatalogue } from "./useCosmetics";
import { isNativeApp } from "./lib/platform";
import { PLANS, DEFAULT_PLAN, CURRENCY, formatMonthly } from "./lib/pricing";

/**
 * Premium.
 *
 * Everything sold here is something OTHER people can see — badges and name
 * colours render from the server's copy of your profile, so they can't be
 * faked. Themes are deliberately NOT the pitch: the CSS ships to every
 * browser, so a locked theme isn't really locked, and charging for one would
 * be charging for something a kid can take with devtools.
 *
 * Prices come from lib/pricing.js and nowhere else. They used to be typed
 * into this file as copy ("$2/mo", three times) while the checkout API
 * charged $4.99 — so the paywall quoted a price Stripe never honoured.
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

const PLAN_LIST = Object.values(PLANS);

export default function Premium({
  open,
  onClose,
  onSubscribe,
  isPremium,
  busy,
  error,
}) {
  const { list } = useCosmeticCatalogue();
  const [plan, setPlan] = useState(DEFAULT_PLAN);

  // Never render any Premium/purchase UI inside the native iOS app —
  // Apple's anti-steering rules forbid it. Web (wavo.lol) is unaffected.
  if (!open || isNativeApp) return null;

  const nameStyles = list.filter((c) => c.kind === "name_style");
  const chosen = PLANS[plan] ?? PLANS[DEFAULT_PLAN];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal premium-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <div className="premium-head">
          <Star size={22} />
          <h2>Wavo Premium</h2>
          <p>{formatMonthly(chosen.price)}. Keeps the lights on.</p>
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
                {formatMonthly(chosen.price)}
              </span>
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
            <div className="premium-plans" role="radiogroup" aria-label="Plan">
              {PLAN_LIST.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={plan === p.id}
                  className={`premium-plan ${plan === p.id ? "on" : ""}`}
                  onClick={() => setPlan(p.id)}
                >
                  <span className="premium-plan-name">{p.label}</span>
                  <span className="premium-plan-price">
                    {formatMonthly(p.price)}
                  </span>
                  <span className="premium-plan-note">
                    {p.requiresStudentDeclaration
                      ? "Honour system — just tick it if you're at school."
                      : p.blurb}
                  </span>
                </button>
              ))}
            </div>
            <button
              className="premium-cta"
              onClick={() => onSubscribe(plan)}
              disabled={busy}
            >
              {busy
                ? "Opening…"
                : `Get Premium — ${formatMonthly(chosen.price)}`}
            </button>
            {error && <p className="premium-error">{error}</p>}
            <p className="premium-fineprint">
              Billed monthly in {CURRENCY}. Ask a parent before you subscribe.
              Cancel any time.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
