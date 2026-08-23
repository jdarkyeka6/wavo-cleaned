const PREFIX = "wavo:offline:v2";

function key(userId, kind, id = "") {
  return `${PREFIX}:${userId || "anon"}:${kind}${id ? `:${id}` : ""}`;
}

function read(k, fallback = null) {
  try {
    const raw = localStorage.getItem(k);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(k, value) {
  try {
    localStorage.setItem(k, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in private/low-space modes. Offline support
    // should degrade quietly rather than break the app.
    return false;
  }
  return true;
}

export function cacheAppData(userId, data) {
  write(key(userId, "app"), { savedAt: Date.now(), data });
}

export function loadCachedAppData(userId) {
  return read(key(userId, "app"))?.data || null;
}

export function cacheMessages(userId, conversationKey, messages) {
  write(key(userId, "messages", conversationKey), { savedAt: Date.now(), messages: (messages || []).slice(-300) });
}

export function loadCachedMessages(userId, conversationKey) {
  return read(key(userId, "messages", conversationKey))?.messages || [];
}

export function getDraft(userId, conversationKey) {
  return read(key(userId, "draft", conversationKey), "") || "";
}

export function setDraft(userId, conversationKey, text) {
  const k = key(userId, "draft", conversationKey);
  if (!text) {
    try {
      localStorage.removeItem(k);
    } catch {
      return false;
    }
    return true;
  }
  return write(k, text);
}

export function getUxPrefs(userId) {
  return read(key(userId, "prefs"), {
    favoriteReactions: ["❤️", "😂", "🔥", "👀"],
    recentFriends: [],
    recentSpaces: [],
    mutedSpaces: {},
  });
}

export function updateUxPrefs(userId, patch) {
  const next = { ...getUxPrefs(userId), ...patch };
  write(key(userId, "prefs"), next);
  return next;
}

export function rememberRecent(userId, kind, targetId) {
  if (!targetId) return getUxPrefs(userId);
  const prefs = getUxPrefs(userId);
  const field = kind === "space" ? "recentSpaces" : "recentFriends";
  const next = [targetId, ...(prefs[field] || []).filter((id) => id !== targetId)].slice(0, 6);
  return updateUxPrefs(userId, { [field]: next });
}

export function queueOutbox(userId, item) {
  const items = read(key(userId, "outbox"), []);
  const queued = { id: crypto.randomUUID(), queuedAt: Date.now(), ...item };
  write(key(userId, "outbox"), [...items, queued]);
  return queued;
}

export function getOutbox(userId) {
  return read(key(userId, "outbox"), []);
}

export function removeOutboxItem(userId, id) {
  write(key(userId, "outbox"), getOutbox(userId).filter((item) => item.id !== id));
}

export function clearUserOfflineData(userId) {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(`${PREFIX}:${userId}:`)).forEach((k) => localStorage.removeItem(k));
    return true;
  } catch {
    return false;
  }
}
