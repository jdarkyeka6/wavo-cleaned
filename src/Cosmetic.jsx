import { useCosmeticCatalogue } from "./useCosmetics";
import { nameStyleProps } from "./lib/cosmeticStyles";

/**
 * A username, wearing whatever the server says it's allowed to wear.
 *
 * The important property: a badge and a name colour are read off *someone
 * else's* profile row, which comes from the server. So a user can lie to
 * their own browser all they like — nobody else will see it.
 *
 * That's why premium is badges and name colours, not themes. A theme is CSS
 * that ships to every browser; it can't really be locked. Status can.
 */
export function UserLabel({ user, name, className = "" }) {
  const { map } = useCosmeticCatalogue();
  if (!user && !name) return null;

  const label = name ?? user?.username ?? "Unknown";
  const style = user?.equipped_name_style ? map[user.equipped_name_style] : null;
  const badge = user?.equipped_badge ? map[user.equipped_badge] : null;
  const nameProps = nameStyleProps(style);

  return (
    <span className={`user-label ${className}`}>
      <span className={nameProps.className} style={nameProps.style}>
        {label}
      </span>
      {badge && (
        <span
          className="user-badge"
          title={badge.name}
          style={badge.payload?.color ? { color: badge.payload.color } : undefined}
        >
          {badge.payload?.emoji}
        </span>
      )}
    </span>
  );
}
