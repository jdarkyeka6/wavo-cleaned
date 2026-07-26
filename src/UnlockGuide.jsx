import { ArrowLeft, Check } from "lucide-react";
import { swatchStyle } from "./lib/cosmeticStyles";

/**
 * "What do I have to do to get that?"
 *
 * The theme and badge grids answer this only in passing — a locked item shows
 * a progress chip, and the goal behind it lives in a tooltip a phone can't
 * show at all. There was nowhere to see the whole ladder: what you already
 * earned and how, and what the next thing costs.
 *
 * This is that list. Everything unlockable, grouped by the one number that
 * unlocks it, in ascending order — so the row under your current position is
 * always the next thing to aim at.
 */

// Each earned cosmetic hangs off exactly one stat. Grouping by that stat is
// what turns 25 scattered items into three short ladders you can read.
const GROUPS = [
  {
    key: "longest_streak",
    // Older catalogue rows key off current_streak; it's the same ladder.
    stats: ["longest_streak", "current_streak"],
    icon: "🔥",
    title: "Streak",
    blurb: "Days in a row. Opening Wavo or sending a message both count.",
    unit: (n) => `${n} day streak`,
  },
  {
    key: "days_active",
    stats: ["days_active"],
    icon: "📅",
    title: "Days active",
    blurb: "Days you turned up at all — they don't have to be consecutive.",
    unit: (n) => `Open Wavo on ${n} days`,
  },
  {
    key: "messages_sent",
    stats: ["messages_sent"],
    icon: "💬",
    title: "Messages sent",
    blurb: "Everything you send, in DMs and groups.",
    unit: (n) => `Send ${n} messages`,
  },
];

const KIND_LABEL = { theme: "Theme", badge: "Badge", name_style: "Name" };

/** The little preview to the left of a row: a swatch, or the badge itself. */
function Preview({ item }) {
  if (item.kind === "badge") {
    return (
      <span className="unlock-emoji" style={{ color: item.payload?.color }}>
        {item.payload?.emoji}
      </span>
    );
  }
  return (
    <span
      className={`unlock-swatch${item.payload?.gradient ? " is-gradient" : ""}`}
      style={swatchStyle(item)}
    />
  );
}

function Row({ item, req, owned, onClaim }) {
  const claimable = req?.kind === "earned" && req.met && !owned;

  return (
    <li className={`unlock-row${owned ? " done" : ""}`}>
      <Preview item={item} />
      <span className="unlock-name">{item.name}</span>
      <span className="unlock-kind">{KIND_LABEL[item.kind] || item.kind}</span>

      {owned ? (
        <span className="unlock-state done">
          <Check size={13} strokeWidth={3} /> Yours
        </span>
      ) : claimable ? (
        <button className="unlock-claim" onClick={() => onClaim(item)}>
          Claim
        </button>
      ) : (
        <span className="unlock-state">
          {req?.kind === "premium" ? "Premium" : "Locked"}
        </span>
      )}
    </li>
  );
}

/** How close you are to one milestone, as a bar plus the raw numbers. */
function Progress({ at, need }) {
  const pct = need > 0 ? Math.min(100, (at / need) * 100) : 0;
  return (
    <span className="unlock-progress">
      <span className="unlock-bar" aria-hidden="true">
        <span className="unlock-bar-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="unlock-nums">
        {at}/{need}
      </span>
    </span>
  );
}

export function UnlockGuide({
  catalogue,
  requirement,
  isUsable,
  stats,
  onClaim,
  onBack,
  onGetPremium,
  isPremium,
}) {
  const earned = catalogue.filter((c) => c.unlock_type === "earned");
  const premium = catalogue.filter(
    (c) => c.unlock_type === "premium" || c.min_tier
  );

  // Count anything you've qualified for, not just what you've claimed —
  // "0 of 38" while three rows say Claim reads as though you have nothing.
  const ownedCount = catalogue.filter(
    (c) => c.unlock_type !== "default" && (isUsable(c) || requirement(c)?.met)
  ).length;
  const total = earned.length + premium.length;

  // Anything earned whose stat isn't one of the three ladders still has to
  // appear somewhere, or adding a cosmetic keyed off a new stat would make it
  // silently invisible here.
  const grouped = new Set(GROUPS.flatMap((g) => g.stats));
  const other = earned.filter((c) => !grouped.has(c.unlock_rule?.stat));

  return (
    <section className="settings-section">
      <div className="unlock-head">
        <button className="unlock-back" onClick={onBack} aria-label="Back to Appearance">
          <ArrowLeft size={16} />
        </button>
        <h4>How to unlock</h4>
        <span className="unlock-count">
          {ownedCount} of {total}
        </span>
      </div>

      {GROUPS.map((g) => {
        // current_streak items exist in older catalogue rows; they're the same
        // ladder as longest_streak, so they belong in the same group.
        const inGroup = earned
          .filter((c) => g.stats.includes(c.unlock_rule?.stat))
          .sort(
            (a, b) => Number(a.unlock_rule?.gte ?? 0) - Number(b.unlock_rule?.gte ?? 0)
          );
        if (!inGroup.length) return null;

        const at = Number(stats?.[g.key] ?? 0);

        return (
          <div className="unlock-group" key={g.key}>
            <div className="unlock-group-head">
              <span className="unlock-group-title">
                <span aria-hidden="true">{g.icon}</span> {g.title}
              </span>
              <span className="unlock-group-at">
                you're at <strong>{at}</strong>
              </span>
            </div>
            <p className="unlock-blurb">{g.blurb}</p>

            <ul className="unlock-list">
              {/* One heading per milestone, not per item: 365 days hands out a
                  theme, a badge and a name, and listing the goal three times
                  hides that they arrive together. */}
              {[...new Set(inGroup.map((c) => Number(c.unlock_rule?.gte ?? 0)))].map(
                (need) => {
                  const reached = Number(stats?.[g.key] ?? 0) >= need;
                  return (
                    <li
                      key={need}
                      className={`unlock-step${reached ? " reached" : ""}`}
                    >
                      <div className="unlock-step-head">
                        <span className="unlock-goal">
                          {reached && (
                            <Check size={12} strokeWidth={3} aria-hidden="true" />
                          )}
                          {g.unit(need)}
                        </span>
                        {!reached && (
                          <Progress at={Number(stats?.[g.key] ?? 0)} need={need} />
                        )}
                      </div>
                      <ul className="unlock-items">
                        {inGroup
                          .filter((c) => Number(c.unlock_rule?.gte ?? 0) === need)
                          .map((item) => (
                            <Row
                              key={item.id}
                              item={item}
                              req={requirement(item)}
                              owned={isUsable(item)}
                              onClaim={onClaim}
                            />
                          ))}
                      </ul>
                    </li>
                  );
                }
              )}
            </ul>
          </div>
        );
      })}

      {other.length > 0 && (
        <div className="unlock-group">
          <div className="unlock-group-head">
            <span className="unlock-group-title">
              <span aria-hidden="true">🎁</span> Other
            </span>
          </div>
          {/* No shared ladder to head these with, so each carries its own
              requirement straight off the catalogue row. */}
          <ul className="unlock-list">
            {other.map((item) => {
              const req = requirement(item);
              return (
                <li key={item.id} className="unlock-step">
                  <div className="unlock-step-head">
                    <span className="unlock-goal">{item.description}</span>
                    {req?.kind === "earned" && !isUsable(item) && (
                      <Progress at={req.have} need={req.need} />
                    )}
                  </div>
                  <ul className="unlock-items">
                    <Row
                      item={item}
                      req={req}
                      owned={isUsable(item)}
                      onClaim={onClaim}
                    />
                  </ul>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {premium.length > 0 && (
        <div className="unlock-group">
          <div className="unlock-group-head">
            <span className="unlock-group-title">
              <span aria-hidden="true">⭐</span> Premium
            </span>
            <span className="unlock-group-at">
              {isPremium ? "active" : "not active"}
            </span>
          </div>
          <p className="unlock-blurb">
            These come with a subscription rather than a milestone.
          </p>
          <ul className="unlock-items">
            {premium.map((item) => (
              <Row
                key={item.id}
                item={item}
                req={requirement(item)}
                owned={isUsable(item)}
                onClaim={onClaim}
              />
            ))}
          </ul>
          {!isPremium && onGetPremium && (
            <button className="cos-upsell" onClick={onGetPremium}>
              ⭐ Get Premium
            </button>
          )}
        </div>
      )}
    </section>
  );
}
