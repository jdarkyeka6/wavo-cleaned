import webpush from "npm:web-push@3.6.7";
import { SignJWT, importPKCS8 } from "npm:jose@5.9.6";
import { createClient } from "jsr:@supabase/supabase-js@2";

const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:contact@builtbyjake.site";

const APNS_KEY_P8 = Deno.env.get("APNS_KEY_P8") ?? "";
const APNS_KEY_ID = Deno.env.get("APNS_KEY_ID") ?? "";
const APNS_TEAM_ID = Deno.env.get("APNS_TEAM_ID") ?? "";
const APNS_TOPIC = Deno.env.get("APNS_TOPIC") ?? "lol.wavo.app";
const APNS_HOST = (Deno.env.get("APNS_ENV") ?? "sandbox") === "production"
  ? "https://api.push.apple.com"
  : "https://api.sandbox.push.apple.com";

const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || (() => {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    return keys.default || Object.values(keys)[0] || "";
  } catch {
    return "";
  }
})();

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  serviceRole,
);

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

let apnsToken: { jwt: string; madeAt: number } | null = null;
async function apnsJwt(): Promise<string | null> {
  if (!APNS_KEY_P8 || !APNS_KEY_ID || !APNS_TEAM_ID) return null;
  if (apnsToken && Date.now() - apnsToken.madeAt < 50 * 60 * 1000) {
    return apnsToken.jwt;
  }

  const pem = APNS_KEY_P8.replace(/\\n/g, "\n");
  const key = await importPKCS8(pem, "ES256");
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: APNS_KEY_ID })
    .setIssuer(APNS_TEAM_ID)
    .setIssuedAt()
    .sign(key);

  apnsToken = { jwt, madeAt: Date.now() };
  return jwt;
}

const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

type PushSub = {
  id: string;
  platform: string;
  subscription: Record<string, unknown> | null;
  device_token: string | null;
};

type ApnsOptions = {
  topic: string;
  pushType: "alert" | "voip";
  priority: "10" | "5";
};

async function sendApns(
  deviceToken: string,
  body: Record<string, unknown>,
  options: ApnsOptions,
): Promise<Response | null> {
  const jwt = await apnsJwt();
  if (!jwt) return null;

  return fetch(`${APNS_HOST}/3/device/${deviceToken}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${jwt}`,
      "apns-topic": options.topic,
      "apns-push-type": options.pushType,
      "apns-priority": options.priority,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function classifyApnsFailure(
  sub: PushSub,
  res: Response,
  dead: string[],
  failures: string[],
) {
  const text = await res.text();
  if (res.status === 410 || /BadDeviceToken|Unregistered/.test(text)) {
    dead.push(sub.id);
  }
  failures.push(`${sub.platform} ${res.status}: ${text.slice(0, 120)}`);
}

async function sendCallEnd(
  event: Record<string, unknown>,
): Promise<Response> {
  const userId = String(event.user_id || "");
  const callId = String(event.call_id || "");
  const status = String(event.status || "ended");

  if (!isUuid(userId) || !isUuid(callId)) {
    return new Response(JSON.stringify({ error: "invalid call event" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, platform, subscription, device_token")
    .eq("user_id", userId)
    .eq("platform", "ios_voip");

  if (!subs?.length) {
    return new Response(JSON.stringify({ sent: 0, reason: "no voip devices" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const dead: string[] = [];
  const failures: string[] = [];
  let sent = 0;

  await Promise.all((subs as PushSub[]).map(async (sub) => {
    if (!sub.device_token) return;
    try {
      const res = await sendApns(
        sub.device_token,
        {
          aps: {},
          event: "end",
          callUUID: callId,
          status,
        },
        {
          topic: `${APNS_TOPIC}.voip`,
          pushType: "voip",
          priority: "10",
        },
      );

      if (!res) {
        failures.push("ios_voip: APNs key not configured");
      } else if (res.ok) {
        sent++;
      } else {
        await classifyApnsFailure(sub, res, dead, failures);
      }
    } catch (err) {
      failures.push(`ios_voip: ${(err as Error).message?.slice(0, 120)}`);
    }
  }));

  if (dead.length) {
    await admin.from("push_subscriptions").delete().in("id", dead);
  }

  return new Response(JSON.stringify({ sent, pruned: dead.length, failures }), {
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let dispatchId: string | undefined;
  try {
    ({ dispatch_id: dispatchId } = await req.json());
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  if (!dispatchId || !isUuid(dispatchId)) {
    return new Response("Missing dispatch_id", { status: 400 });
  }

  // The DB trigger creates a random one-use dispatch row. Consuming it here
  // means callers cannot choose a recipient or replay a push.
  const { data: dispatch, error: dispatchError } = await admin
    .from("push_dispatch_queue")
    .delete()
    .eq("id", dispatchId)
    .select("notification_id, call_event")
    .single();

  if (dispatchError || !dispatch) {
    return new Response(JSON.stringify({ error: "invalid or consumed dispatch" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (dispatch.call_event?.kind === "call_end") {
    return sendCallEnd(dispatch.call_event);
  }

  if (!dispatch.notification_id) {
    return new Response(JSON.stringify({ error: "dispatch has no payload" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: notif, error } = await admin
    .from("notifications")
    .select("id, user_id, sender_id, title, body, chat_id")
    .eq("id", dispatch.notification_id)
    .single();

  if (error || !notif) {
    return new Response(JSON.stringify({ error: "notification not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rawChatId = typeof notif.chat_id === "string" ? notif.chat_id : "";
  const rawCallId = rawChatId.startsWith("call:") ? rawChatId.slice(5) : "";
  const callId = isUuid(rawCallId) ? rawCallId : null;
  const hasVideo = !String(notif.title || "").toLowerCase().includes("voice");

  let senderUsername = "";
  if (notif.sender_id) {
    const { data: sender } = await admin
      .from("profiles")
      .select("username")
      .eq("id", notif.sender_id)
      .maybeSingle();
    senderUsername = sender?.username || "";
  }

  let url = "/chats";
  if (senderUsername && (!rawChatId || callId || !isUuid(rawChatId))) {
    url = `/chats/${encodeURIComponent(senderUsername)}`;
  }

  const payload = {
    title: notif.title || "Wavo",
    body: notif.body || "",
    url,
    tag: `wavo-${notif.chat_id ?? "general"}`,
    sender_id: notif.sender_id,
  };

  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, platform, subscription, device_token")
    .eq("user_id", notif.user_id);

  if (!subs?.length) {
    return new Response(JSON.stringify({ sent: 0, reason: "no devices" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const typedSubs = subs as PushSub[];
  const hasVoipDevice = Boolean(callId) && typedSubs.some((sub) => sub.platform === "ios_voip");
  const dead: string[] = [];
  let sent = 0;
  const failures: string[] = [];

  await Promise.all(typedSubs.map(async (sub) => {
    try {
      if (sub.platform === "web") {
        if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
          failures.push("web: VAPID keys not configured");
          return;
        }
        await webpush.sendNotification(sub.subscription, JSON.stringify(payload));
        sent++;
        return;
      }

      if (sub.platform === "ios_voip") {
        if (!callId || !sub.device_token) return;

        const res = await sendApns(
          sub.device_token,
          {
            aps: {},
            event: "incoming",
            callUUID: callId,
            callerName: senderUsername ? `@${senderUsername}` : "Wavo caller",
            hasVideo,
          },
          {
            topic: `${APNS_TOPIC}.voip`,
            pushType: "voip",
            priority: "10",
          },
        );

        if (!res) {
          failures.push("ios_voip: APNs key not configured");
        } else if (res.ok) {
          sent++;
        } else {
          await classifyApnsFailure(sub, res, dead, failures);
        }
        return;
      }

      if (sub.platform === "ios") {
        if (!sub.device_token) return;

        // Once this account has a PushKit device, incoming calls use CallKit.
        // Do not also show the old alert banner for the same call.
        if (callId && hasVoipDevice) return;

        const res = await sendApns(
          sub.device_token,
          {
            aps: {
              alert: { title: payload.title, body: payload.body },
              sound: "default",
              "thread-id": payload.tag,
            },
            url: payload.url,
            sender_id: payload.sender_id,
          },
          {
            topic: APNS_TOPIC,
            pushType: "alert",
            priority: "10",
          },
        );

        if (!res) {
          failures.push("ios: APNs key not configured");
        } else if (res.ok) {
          sent++;
        } else {
          await classifyApnsFailure(sub, res, dead, failures);
        }
      }
    } catch (err) {
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) {
        dead.push(sub.id);
      }
      failures.push(`${sub.platform} ${status ?? ""}: ${(err as Error).message?.slice(0, 120)}`);
    }
  }));

  if (dead.length) {
    await admin.from("push_subscriptions").delete().in("id", dead);
  }

  return new Response(
    JSON.stringify({ sent, pruned: dead.length, failures }),
    { headers: { "Content-Type": "application/json" } },
  );
});
