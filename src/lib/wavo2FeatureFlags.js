// Wavo 2.0 features are intentionally OFF until server rollout is verified.
// Never use these flags as an authorization boundary: enforce access in Supabase.
export const WAVO2_FLAGS = Object.freeze({
  play_enabled: false,
  discover_enabled: false,
  identity_v2_enabled: false,
  chat_challenges_enabled: false,
  new_navigation_enabled: false,
});

export function resolveWavo2Flags(remote = {}, defaults = WAVO2_FLAGS) {
  const safeRemote = remote && typeof remote === 'object' && !Array.isArray(remote) ? remote : {};
  return Object.fromEntries(
    Object.entries(defaults).map(([key, fallback]) => [
      key,
      typeof safeRemote[key] === 'boolean' ? safeRemote[key] : fallback,
    ]),
  );
}

export function isWavo2FeatureEnabled(flag, flags = WAVO2_FLAGS) {
  return Object.hasOwn(WAVO2_FLAGS, flag) && flags?.[flag] === true;
}
