import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, isConfigured } from "./lib/config";

const client = createClient(
  SUPABASE_URL || "https://placeholder.invalid",
  SUPABASE_ANON_KEY || "placeholder"
);

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

let lastPing = 0;
if (isConfigured) {
  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session?.user) return;
    const now = Date.now();
    if (now - lastPing < 60_000) return;
    lastPing = now;
    supabase.rpc("ping_activity").then(
      () => {},
      () => {}
    );
  });
}
