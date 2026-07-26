// Per-conversation drafts.
//
// Kept in localStorage rather than the database on purpose: a half-typed
// message is device-local, and syncing it would mean writing to the server on
// every keystroke. Switching chats, closing the tab and reopening it all
// preserve what you were in the middle of saying.

const PREFIX = "wavo-draft:";
const MAX = 4000;

export const draftKeyFor = (group, user) =>
  group ? `group:${group.id}` : user ? `dm:${user.id}` : null;

export function readDraft(key) {
  if (!key) return "";
  try {
    return localStorage.getItem(PREFIX + key) || "";
  } catch {
    return "";
  }
}

export function writeDraft(key, text) {
  if (!key) return;
  try {
    const clean = (text || "").slice(0, MAX);
    // An empty draft is a deleted draft — otherwise every conversation you
    // ever opened leaves a blank entry behind forever.
    if (clean.trim()) localStorage.setItem(PREFIX + key, clean);
    else localStorage.removeItem(PREFIX + key);
  } catch {
    /* private mode, quota — a lost draft isn't worth breaking send over */
  }
}

export function clearDraft(key) {
  writeDraft(key, "");
}

/** Which conversations currently hold a draft, for the sidebar hint. */
export function draftKeysWithText() {
  const keys = new Set();
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX) && localStorage.getItem(k)?.trim()) {
        keys.add(k.slice(PREFIX.length));
      }
    }
  } catch {
    /* ignore */
  }
  return keys;
}
