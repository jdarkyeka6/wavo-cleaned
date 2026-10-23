// Only app-internal paths are valid notification destinations.
// Reject network-path references (//host), backslashes and control characters.
// Parse against a fixed origin so callers cannot supply their own authority.
export function safeNotificationUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null;
  if ([...value].some((character) => {
    const code = character.charCodeAt(0);
    return code === 92 || code < 32 || code === 127;
  })) return null;
  try {
    const origin = 'https://wavo.invalid';
    const parsed = new URL(value, origin);
    if (parsed.origin !== origin) return null;
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return null;
  }
}
