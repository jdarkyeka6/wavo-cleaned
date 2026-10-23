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

function notifyOutboxChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("wavo:outbox-changed"));
  }
}

export function queueOutbox(userId, item) {
  // Keep the same client UUID through reconnects. Retrying an already queued
  // UUID must never duplicate it or overwrite the original target/content.
  const items = read(key(userId, "outbox"), []);
  const queuedId = item.id || crypto.randomUUID();
  const existing = items.find((pending) => pending.id === queuedId);
  if (existing) return existing;

  const queued = { ...item, id: queuedId, queuedAt: Date.now() };
  if (!write(key(userId, "outbox"), [...items, queued])) {
    throw new Error("Offline storage is full. This message was not queued.");
  }
  notifyOutboxChanged();
  return queued;
}

export function getOutbox(userId) {
  return read(key(userId, "outbox"), []);
}

export function removeOutboxItem(userId, id) {
  const items = getOutbox(userId);
  // Do not claim an offline Undo succeeded if local storage failed. The item
  // could otherwise still be delivered later even after vanishing from UI.
  const saved = write(key(userId, "outbox"), items.filter((item) => item.id !== id));
  if (saved) notifyOutboxChanged();
  return saved;
}

export function updateOutboxItem(userId, id, patch) {
  const items = getOutbox(userId);
  if (!items.some((item) => item.id === id)) return false;
  const next = items.map((item) => item.id === id ? { ...item, ...patch, id: item.id } : item);
  if (!write(key(userId, "outbox"), next)) return false;
  notifyOutboxChanged();
  return true;
}

export function clearUserOfflineData(userId) {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(`${PREFIX}:${userId}:`)).forEach((k) => localStorage.removeItem(k));
    return true;
  } catch {
    return false;
  }
}
