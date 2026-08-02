# Push notifications — setup

The code is all in. Push stays **off** until the secrets below are set, and
everything degrades quietly until then: `dispatch_push()` returns early when the
vault entries are missing, and `subscribeToPush()` logs one line and stops when
`VITE_VAPID_PUBLIC_KEY` is unset. Nothing breaks, nothing arrives.

## How it fits together

```
message insert
  → on_message_notify / on_group_message_notify   (row in notifications)
  → on_notification_push → dispatch_push()        (pg_net, async)
  → send-push edge function
      ├─ web : VAPID + Web Push → browser → sw.js → showNotification
      └─ ios : APNs JWT         → api.push.apple.com → native banner
```

Only the notification **id** crosses the wire. `send-push` reads the row back
with the service role, so anyone who obtained the hook secret still can't
dictate the title, body or recipient of a push.

## 1. Supabase edge function secrets

Set these on the `send-push` function (Dashboard → Edge Functions → send-push →
Secrets, or `supabase secrets set`).

| Secret | Where it comes from |
|---|---|
| `PUSH_HOOK_SECRET` | **Already generated.** Dashboard → Integrations → Vault → `send_push_secret`. Copy that value here verbatim — the trigger sends it as `x-push-secret` and the function compares. |
| `VAPID_PUBLIC_KEY` | From the generated keypair (see below). |
| `VAPID_PRIVATE_KEY` | From the generated keypair. Never ships to the browser. |
| `VAPID_SUBJECT` | `mailto:contact@builtbyjake.site` — optional, that's the default. |
| `APNS_KEY_P8` | Contents of the `.p8` from Apple. Newlines may be written as `\n`. |
| `APNS_KEY_ID` | The 10-character Key ID shown when you create the key. |
| `APNS_TEAM_ID` | Apple Developer team ID. |
| `APNS_TOPIC` | `lol.wavo.app` — optional, that's the default and matches the bundle id. |
| `APNS_ENV` | `production` for TestFlight and App Store builds. Defaults to `sandbox`, which is only right for debug builds run from Xcode. |

The vault already holds `send_push_url` and `send_push_secret`; the trigger reads
both. You only need to mirror the secret into the function's environment.

## 2. Vercel

| Variable | Value |
|---|---|
| `VITE_VAPID_PUBLIC_KEY` | The same public key. It is baked into the bundle at build time, so a **redeploy is required** — setting it without rebuilding changes nothing. |

Only the public half. It's what the browser encrypts to; it can't send anything.

## 3. Apple, one time

1. Certificates, Identifiers & Profiles → Keys → **+**, tick **Apple Push
   Notifications service (APNs)**, download the `.p8`. Apple lets you download
   it exactly once.
2. Identifiers → `lol.wavo.app` → enable the **Push Notifications** capability.
3. Regenerate the provisioning profile used by the TestFlight workflow, so it
   carries the push entitlement. A profile made before step 2 does not.

The repo side is already done: `App.entitlements` (development) and
`AppRelease.entitlements` (production) are wired into the Debug and Release
build configs, `UIBackgroundModes` includes `remote-notification`, and
`AppDelegate.swift` forwards the APNs token to the Capacitor plugin.

## Generating VAPID keys

Any of these produce the same thing — one P-256 keypair, base64url:

```sh
npx web-push generate-vapid-keys
```

A pair was generated when this landed and handed over separately. If you've lost
it, generate a new one — but note that **rotating VAPID keys invalidates every
existing web subscription**, so every browser has to re-subscribe. Rows are
pruned automatically when the push service starts returning 404/410.

## Checking it works

The whole chain can be exercised from SQL, without a browser:

```sql
-- Insert a notification for yourself, then look at what came back.
insert into public.notifications (user_id, title, body, chat_id)
values ('<your profile id>', 'Wavo', 'test', 'test');

select status_code, left(content, 200), created
from net._http_response order by created desc limit 1;
```

| What you see | What it means |
|---|---|
| `403 Forbidden` | `PUSH_HOOK_SECRET` isn't set on the function, or doesn't match the vault value. |
| `{"sent":0,"reason":"no devices"}` | Chain is healthy; that user just has no registered device yet. |
| `{"sent":1,...}` | Working. |
| `failures: ["web: VAPID keys not configured"]` | The function is missing `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`. |
| `failures: ["ios 403: ..."]` | APNs rejected the JWT — usually the wrong team id, or `APNS_ENV` pointing at the environment the token didn't come from. |
| nothing in `net._http_response` | The vault entries are missing, so `dispatch_push()` returned early. |

Delete the test row afterwards; it shows up in the recipient's bell.

## Known limits

- **Web push on iPhone needs Wavo added to the Home Screen** (iOS 16.4+). In
  plain Safari there is no PushManager, so nothing registers.
- **Groups open the chat list, not the group.** The push carries a URL and
  `useUrlSync` only routes `/chats/:username`, so a group notification lands on
  `/chats`. Giving groups a real route would fix it.
- **No quiet hours, no per-conversation mute.** Every notification row becomes a
  push. The Settings toggle covers in-app notifications only.
