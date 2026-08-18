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
  // means callers cannot choose a recipient or replay a notification.
  const { data: dispatch, error: dispatchError } = await admin
    .from("push_dispatch_queue")
    .delete()
    .eq("id", dispatchId)
    .select("notification_id")
    .single();

  if (dispatchError || !dispatch?.notification_id) {
    return new Response(JSON.stringify({ error: "invalid or consumed dispatch" }), {
      status: 403,
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

  let url = "/chats";
  if (notif.chat_id && !isUuid(notif.chat_id) && notif.sender_id) {
    const { data: sender } = await admin
      .from("profiles")
      .select("username")
      .eq("id", notif.sender_id)
      .single();
    if (sender?.username) url = `/chats/${encodeURIComponent(sender.username)}`;
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

  const dead: string[] = [];
  let sent = 0;
  const failures: string[] = [];

  await Promise.all(subs.map(async (sub) => {
    try {
      if (sub.platform === "web") {
        if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
          failures.push("web: VAPID keys not configured");
          return;
        }
        await webpush.sendNotification(sub.subscription, JSON.stringify(payload));
        sent++;
      } else if (sub.platform === "ios") {
        const jwt = await apnsJwt();
        if (!jwt) {
          failures.push("ios: APNs key not configured");
          return;
        }
        const res = await fetch(`${APNS_HOST}/3/device/${sub.device_token}`, {
          method: "POST",
          headers: {
            authorization: `bearer ${jwt}`,
            "apns-topic": APNS_TOPIC,
            "apns-push-type": "alert",
            "apns-priority": "10",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            aps: {
              alert: { title: payload.title, body: payload.body },
              sound: "default",
              "thread-id": payload.tag,
            },
            url: payload.url,
            sender_id: payload.sender_id,
          }),
        });
        if (res.ok) {
          sent++;
        } else {
          const text = await res.text();
          if (res.status === 410 || /BadDeviceToken|Unregistered/.test(text)) {
            dead.push(sub.id);
          }
          failures.push(`ios ${res.status}: ${text.slice(0, 120)}`);
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
