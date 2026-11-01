// Keep founder access distinct from billing entitlements. Founders receive the
// Black membership presentation without replacing their protected "founder" source.
const BLACK_MEMBERSHIP_SOURCES = new Set(['founder', 'stripe_black', 'apple_black'])

export function isBlackMember(profile, now = Date.now()) {
  if (!profile?.is_premium) return false
  if (profile.premium_until) {
    const expiresAt = new Date(profile.premium_until).getTime()
    if (!Number.isFinite(expiresAt) || expiresAt <= now) return false
  }
  return BLACK_MEMBERSHIP_SOURCES.has(String(profile.entitlement_source || '').toLowerCase())
}
