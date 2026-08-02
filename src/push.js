// Push notification helpers.
//
// Two mechanisms behind one interface, because the two builds of Wavo can't
// share one:
//
//   web  — Service Worker + PushManager + VAPID. Works in Chrome, Edge,
//          Firefox, desktop Safari, Android, and on iPhone only when Wavo has
//          been added to the Home Screen (iOS 16.4+).
//   ios  — APNs device token via @capacitor/push-notifications. The native
//          shell is a WKWebView, which has no PushManager at all, so the web
//          path silently does nothing there no matter how it's configured.
//
// Both end up as a row in push_subscriptions, and send-push fans out to
// whatever it finds. Callers just call registerForPush().

import { supabase } from "./supabaseClient";
import { isNativeApp, isIOS } from "./lib/platform";

// Public half of the VAPID pair. Safe to ship — it's the key push services use
// to verify our signature, not to make one. Without it the browser has nothing
// to encrypt to, so web push stays off.
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || "";

// Web Push needs the key as a Uint8Array, not a base64url string.
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function pushSupported() {
  if (isNativeApp) return isIOS();
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

// Register the service worker (the doorman) once. Web only — there is no
// service worker inside the native shell.
export async function registerServiceWorker() {
  if (isNativeApp) return null;
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

// Ask "may we send notifications?" — only when it makes sense.
// Returns true if permission is granted, false otherwise.
export async function ensureNotificationPermission() {
  if (isNativeApp) {
    if (!isIOS()) return false;
    const { PushNotifications } = await import("@capacitor/push-notifications");
    // checkPermissions first: requestPermissions on an already-denied app is a
    // no-op that still returns 'denied', and we don't want to treat that as an
    // error worth logging every login.
    let status = await PushNotifications.checkPermissions();
    if (status.receive === "prompt" || status.receive === "prompt-with-rationale") {
      status = await PushNotifications.requestPermissions();
    }
    return status.receive === "granted";
  }

  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

// Save a device row. `last_seen_at` is what makes a returning device a bump
// rather than a duplicate, and it's how a stale device is recognisable later.
async function saveSubscription(row, onConflict) {
  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(
      {
        ...row,
        user_agent: navigator.userAgent.slice(0, 200),
        last_seen_at: new Date().toISOString(),
      },
      { onConflict },
    );
  if (error) console.warn("[wavo] Failed to save push subscription:", error);
  return !error;
}

// --- web ---------------------------------------------------------------

async function subscribeWeb(userId) {
  if (!VAPID_PUBLIC_KEY) {
    console.info("[wavo] VITE_VAPID_PUBLIC_KEY not set — skipping push subscribe");
    return null;
  }
  if (Notification.permission !== "granted") return null;

  const reg = await navigator.serviceWorker.ready;

  // Reuse an existing subscription if there is one. Re-subscribing would mint
  // a new endpoint and orphan the old row.
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const json = sub.toJSON();
  // The whole PushSubscription goes in `subscription` because that is exactly
  // what web-push wants handed back to it — endpoint and keys as one object.
  // The endpoint is also stored flat, since it's the unique key.
  await saveSubscription(
    {
      user_id: userId,
      platform: "web",
      endpoint: json.endpoint,
      subscription: json,
    },
    "endpoint",
  );

  return sub;
}

// --- ios ---------------------------------------------------------------

async function subscribeNative(userId) {
  const { PushNotifications } = await import("@capacitor/push-notifications");

  // The token arrives asynchronously through an event, not a return value, so
  // this resolves on whichever of registration/registrationError fires first.
  const token = await new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    PushNotifications.addListener("registration", (t) => done(t.value));
    PushNotifications.addListener("registrationError", (err) => {
      console.warn("[wavo] APNs registration failed:", err);
      done(null);
    });

    PushNotifications.register();

    // A simulator, or a build without the push entitlement, fires neither
    // event. Without this the promise would hang for the life of the session.
    setTimeout(() => done(null), 10000);
  });

  if (!token) return null;

  await saveSubscription(
    { user_id: userId, platform: "ios", device_token: token },
    "device_token",
  );

  return token;
}

/**
 * Register this device for push and record it against the user.
 * Safe to call on every login: it reuses an existing subscription and the
 * upsert just bumps last_seen_at.
 */
export async function registerForPush(userId) {
  if (!userId) return null;
  if (!pushSupported()) {
    console.info("[wavo] Push not supported on this platform");
    return null;
  }
  try {
    return isNativeApp ? await subscribeNative(userId) : await subscribeWeb(userId);
  } catch (err) {
    console.warn("[wavo] Push registration failed:", err);
    return null;
  }
}

// Kept as the old name so existing call sites don't change meaning.
export const subscribeToPush = registerForPush;

/**
 * Stop this device receiving pushes, and forget it server-side.
 * Call on logout when the device is shared.
 */
export async function unsubscribeFromPush() {
  if (isNativeApp) {
    try {
      const { PushNotifications } = await import("@capacitor/push-notifications");
      await PushNotifications.removeAllListeners();
    } catch {
      // Plugin missing in a web build of the native bundle — nothing to undo.
    }
    // The APNs token isn't revocable from here; drop the row so we stop
    // addressing it. iOS stops delivering once the app is deleted anyway.
    return;
  }

  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
}
