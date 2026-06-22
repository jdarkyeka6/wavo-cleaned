// Push notification helpers — handles the "register a phone number" flow.
// Called from App.jsx after login.

import { supabase } from "./supabaseClient";

// VAPID public key: paste yours here after generating it in step 2.
// Until you do, push registration will skip silently (in-app notifs still work).
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || "";

// Web Push needs the key as a Uint8Array, not a base64 string.
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function pushSupported() {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

// Register the service worker (the doorman) once.
export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    return reg;
  } catch (err) {
    console.warn("[wavo] SW register failed:", err);
    return null;
  }
}

// Ask the user "may we send notifications?" — only when it makes sense.
// Returns true if permission is granted, false otherwise.
export async function ensureNotificationPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

// Subscribe to push and save the subscription to Supabase.
// Call this AFTER login and AFTER permission is granted.
export async function subscribeToPush(userId) {
  if (!pushSupported()) {
    console.info("[wavo] Push not supported in this browser");
    return null;
  }
  if (!VAPID_PUBLIC_KEY) {
    console.info("[wavo] VITE_VAPID_PUBLIC_KEY not set — skipping push subscribe");
    return null;
  }
  if (Notification.permission !== "granted") return null;

  const reg = await navigator.serviceWorker.ready;

  // Reuse existing subscription if we have one, otherwise create a new one.
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const json = sub.toJSON();
  const row = {
    user_id: userId,
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    user_agent: navigator.userAgent.slice(0, 200),
    last_seen_at: new Date().toISOString(),
  };

  // Upsert on endpoint — if this exact subscription already exists (e.g.
  // same browser, second login), just bump last_seen_at.
  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(row, { onConflict: "endpoint" });

  if (error) console.warn("[wavo] Failed to save push subscription:", error);
  return sub;
}

// Unsubscribe — call this on logout if you want to stop receiving pushes
// on this device.
export async function unsubscribeFromPush() {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
}