// Push notification helpers.
//
// Wavo uses three device-addressing paths:
//   web      — Service Worker + PushManager + VAPID.
//   ios      — normal APNs alert token via @capacitor/push-notifications.
//   ios_voip — PushKit token used only for real incoming-call delivery to CallKit.

import { supabase } from "./supabaseClient";
import { isNativeApp, isIOS } from "./lib/platform";
import {
  addVoipTokenListener,
  callKitSupported,
  getCallKitState,
} from "./callKitBridge";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || "";
const IOS_TOKEN_STORAGE_KEY = "wavo_push_device_token";
const IOS_VOIP_TOKEN_STORAGE_KEY = "wavo_voip_device_token";

let voipListenerHandle = null;
let voipListenerUserId = null;

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

export async function ensureNotificationPermission() {
  if (isNativeApp) {
    if (!isIOS()) return false;
    const { PushNotifications } = await import("@capacitor/push-notifications");
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

async function saveWebSubscription(row) {
  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(
      {
        ...row,
        user_agent: navigator.userAgent.slice(0, 200),
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" },
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
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const json = sub.toJSON();
  await saveWebSubscription({
    user_id: userId,
    platform: "web",
    endpoint: json.endpoint,
    subscription: json,
  });

  return sub;
}

// --- standard iOS APNs -----------------------------------------------

async function subscribeNative(userId) {
  const { PushNotifications } = await import("@capacitor/push-notifications");

  let resolveRegistration;
  const tokenPromise = new Promise((resolve) => {
    resolveRegistration = resolve;
  });

  let settled = false;
  let timeoutId;
  const done = (value) => {
    if (settled) return;
    settled = true;
    if (timeoutId) clearTimeout(timeoutId);
    resolveRegistration(value);
  };

  const registrationHandle = await PushNotifications.addListener(
    "registration",
    (t) => done(t.value),
  );
  const registrationErrorHandle = await PushNotifications.addListener(
    "registrationError",
    (err) => {
      console.warn("[wavo] APNs registration failed:", err);
      done(null);
    },
  );

  try {
    await PushNotifications.register();
    timeoutId = setTimeout(() => done(null), 10000);
    const token = await tokenPromise;
    if (!token) return null;

    const { error } = await supabase.rpc("claim_ios_push_subscription", {
      p_device_token: token,
      p_user_agent: navigator.userAgent.slice(0, 200),
    });

    if (error) {
      console.warn("[wavo] Failed to save iOS push subscription:", error);
      return null;
    }

    localStorage.setItem(IOS_TOKEN_STORAGE_KEY, token);
    return token;
  } finally {
    registrationHandle.remove();
    registrationErrorHandle.remove();
  }
}

// --- iOS PushKit / CallKit -------------------------------------------

async function claimVoipToken(userId, token) {
  if (!userId || !token) return null;

  const { error } = await supabase.rpc("claim_ios_voip_push_subscription", {
    p_device_token: token,
    p_user_agent: navigator.userAgent.slice(0, 200),
  });

  if (error) {
    console.warn("[wavo] Failed to save iOS VoIP token:", error);
    return null;
  }

  localStorage.setItem(IOS_VOIP_TOKEN_STORAGE_KEY, token);
  return token;
}

async function ensureVoipTokenListener(userId) {
  if (!callKitSupported()) return;
  if (voipListenerHandle && voipListenerUserId === userId) return;

  if (voipListenerHandle) {
    try { await voipListenerHandle.remove(); } catch {}
    voipListenerHandle = null;
  }

  voipListenerUserId = userId;
  voipListenerHandle = await addVoipTokenListener(async ({ token }) => {
    if (!token || !voipListenerUserId) return;
    await claimVoipToken(voipListenerUserId, token);
  });
}

/**
 * Register Wavo's PushKit token for CallKit incoming calls.
 * This does not depend on normal notification permission; PushKit and CallKit
 * are the system calling path, not an alert-notification workaround.
 */
export async function registerVoipForPush(userId) {
  if (!userId || !callKitSupported()) return null;
  try {
    await ensureVoipTokenListener(userId);
    const state = await getCallKitState();
    return state?.voipToken ? await claimVoipToken(userId, state.voipToken) : null;
  } catch (err) {
    console.warn("[wavo] VoIP push registration failed:", err);
    return null;
  }
}

/**
 * Register normal message/alert push for this device.
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

export const subscribeToPush = registerForPush;

export async function unsubscribeFromPush() {
  if (isNativeApp) {
    try {
      const token = localStorage.getItem(IOS_TOKEN_STORAGE_KEY);
      if (token) {
        const { error } = await supabase.rpc("release_ios_push_subscription", {
          p_device_token: token,
        });
        if (error) {
          console.warn("[wavo] Failed to release iOS push subscription:", error);
        } else {
          localStorage.removeItem(IOS_TOKEN_STORAGE_KEY);
        }
      }

      const voipToken = localStorage.getItem(IOS_VOIP_TOKEN_STORAGE_KEY);
      if (voipToken) {
        const { error } = await supabase.rpc("release_ios_voip_push_subscription", {
          p_device_token: voipToken,
        });
        if (error) {
          console.warn("[wavo] Failed to release iOS VoIP subscription:", error);
        } else {
          localStorage.removeItem(IOS_VOIP_TOKEN_STORAGE_KEY);
        }
      }

      if (voipListenerHandle) {
        try { await voipListenerHandle.remove(); } catch {}
        voipListenerHandle = null;
        voipListenerUserId = null;
      }

      const { PushNotifications } = await import("@capacitor/push-notifications");
      await PushNotifications.removeAllListeners();
    } catch (err) {
      console.warn("[wavo] Failed to unsubscribe native push:", err);
    }
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
