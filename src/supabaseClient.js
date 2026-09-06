import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, isConfigured } from "./lib/config";

// Placeholders when the build had no environment. createClient() throws on an
// empty url, and because this module is imported at the root of the graph that
// throw took the whole app down before React ever ran — a black screen with
// nothing to read. main.jsx checks isConfigured and shows an explanation
// instead; these values exist only so the import itself survives that far.
const client = createClient(
  SUPABASE_URL || "https://placeholder.invalid",
  SUPABASE_ANON_KEY || "placeholder"
);

// Supabase already creates a profiles row for new auth users via a database
// trigger. Older signup code also tries to INSERT that same profile row, which
// causes a duplicate primary-key error. Make profile inserts idempotent by
// turning them into an upsert on the profile id.
const originalFrom = client.from.bind(client);
client.from = (table) => {
  const query = originalFrom(table);

  if (table === "profiles") {
    query.insert = (values, options = {}) =>
      query.upsert(values, {
        ...options,
        onConflict: "id",
      });
  }

  return query;
};

// A caller can create the call row successfully and then fail to subscribe to
// the private WebRTC signalling channel. ChatMotionCalls gives that attempt
// about eight seconds before surfacing "Call signalling timed out". Previously
// the database row stayed `ringing`, so the callee could open Wavo afterwards
// and see a dead incoming-call popup. Keep the server state in lockstep with
// that failure path even if the UI component has already torn itself down.
const CALL_SIGNAL_TOPIC = /^wavo-call:([0-9a-f-]{36})$/i;
const originalChannel = client.channel.bind(client);

async function cancelFailedOutgoingCall(callId) {
  try {
    const { data } = await client.auth.getUser();
    const user = data?.user;
    if (!user) return;

    await originalFrom("call_sessions")
      .update({ status: "cancelled" })
      .eq("id", callId)
      .eq("caller_id", user.id)
      .eq("status", "ringing");
  } catch (err) {
    console.warn("[wavo calls] failed to cancel stale signalling call", err);
  }
}

client.channel = (topic, options) => {
  const channel = originalChannel(topic, options);
  const match = CALL_SIGNAL_TOPIC.exec(String(topic || ""));
  if (!match) return channel;

  const callId = match[1];
  const originalSubscribe = channel.subscribe.bind(channel);

  channel.subscribe = (callback, timeout) => {
    let subscribed = false;
    let cleanupStarted = false;

    const cancelOnce = () => {
      if (subscribed || cleanupStarted) return;
      cleanupStarted = true;
      void cancelFailedOutgoingCall(callId);
    };

    // Fire just before ChatMotionCalls' own 8-second signalling timeout so the
    // callee cannot resurrect the row during the error/teardown race.
    const cleanupTimer = window.setTimeout(cancelOnce, 7600);

    return originalSubscribe((status, error) => {
      if (status === "SUBSCRIBED") {
        subscribed = true;
        window.clearTimeout(cleanupTimer);
      } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
        window.clearTimeout(cleanupTimer);
        cancelOnce();
      }

      callback?.(status, error);
    }, timeout);
  };

  return channel;
};

export const supabase = client;

// Wavo AI support watches only messages sent by the signed-in user. The Edge
// Function performs the real authorization and all rate limiting, so this
// client hook is only a trigger and cannot bypass the anti-spam gate.
let supportAiChannel = null;
let supportAiUserId = null;

async function connectSupportAi(user) {
  if (!user?.id || supportAiUserId === user.id) return;

  if (supportAiChannel) {
    try { await client.removeChannel(supportAiChannel); } catch {}
    supportAiChannel = null;
  }

  supportAiUserId = user.id;

  try {
    const { data: support, error } = await originalFrom("profiles")
      .select("id")
      .eq("username", "support")
      .maybeSingle();

    if (error || !support?.id) return;

    supportAiChannel = originalChannel(`wavo-support-ai:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `sender_id=eq.${user.id}`,
        },
        (payload) => {
          const message = payload?.new;
          if (!message || message.receiver_id !== support.id || message.type !== "text") return;

          void client.functions.invoke("support-ai", {
            body: { messageId: message.id },
          }).then(({ error: invokeError }) => {
            if (invokeError) console.warn("[wavo support ai] invoke failed", invokeError);
          }).catch((invokeError) => {
            console.warn("[wavo support ai] invoke failed", invokeError);
          });
        }
      )
      .subscribe();
  } catch (err) {
    console.warn("[wavo support ai] setup failed", err);
  }
}

// Heartbeat: records "this user was active today" for the founder dashboard.
// Fires when the app opens with a signed-in session (and after sign-in).
// The database upsert is idempotent — one row per user per day, so calling
// it repeatedly costs nothing.
let lastPing = 0;
// Skipped when the build had no config: the client points at a placeholder
// host, so this would only produce failing background requests.
if (isConfigured) {
  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session?.user) {
      supportAiUserId = null;
      if (supportAiChannel) {
        void client.removeChannel(supportAiChannel);
        supportAiChannel = null;
      }
      return;
    }

    void connectSupportAi(session.user);

    const now = Date.now();
    if (now - lastPing < 60_000) return; // throttle: at most once per minute
    lastPing = now;
    supabase.rpc("ping_activity").then(
      () => {},
      () => {}
    );
  });
}
