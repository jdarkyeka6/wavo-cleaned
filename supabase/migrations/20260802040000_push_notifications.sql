-- Push notifications: make the subscription table match reality, notify on
-- group messages, and hand every new notification row to the sender function.
--
-- The client half of push has been in the tree for a while (src/push.js,
-- public/sw.js) and has never worked. Two reasons, both fixed here:
--
--   1. subscribeToPush() wrote p256dh, auth, user_agent and last_seen_at.
--      This table has (id, user_id, endpoint, subscription, created_at). Every
--      save would have 400'd. It never got that far because VITE_VAPID_PUBLIC_KEY
--      was unset, so the function returned early and the bug stayed invisible.
--   2. Nothing ever sent a push. There were no edge functions on the project at
--      all — sw.js was a receiver waiting for a sender that didn't exist.

-- pg_net, not the already-installed `http`: http is synchronous, and a trigger
-- that blocks on an HTTP call would make every message send wait for the push
-- to go out. pg_net queues the request and returns immediately.
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- push_subscriptions: one row per device
-- ---------------------------------------------------------------------------

-- iOS in the Capacitor shell can't use Web Push — WKWebView has no PushManager,
-- so the native build is addressed by an APNs device token instead. Same table,
-- because "every device that can be reached for this user" is one question and
-- should be one query.
alter table public.push_subscriptions
  add column if not exists platform     text not null default 'web',
  add column if not exists device_token text,
  add column if not exists user_agent   text,
  add column if not exists last_seen_at timestamptz not null default now();

-- Web rows carry endpoint + subscription; iOS rows carry neither.
alter table public.push_subscriptions alter column endpoint     drop not null;
alter table public.push_subscriptions alter column subscription drop not null;

alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_platform_check;
alter table public.push_subscriptions
  add constraint push_subscriptions_platform_check
  check (platform in ('web', 'ios'));

-- A row has to carry the thing its platform is actually addressed by, or it is
-- a device we cannot reach and should never have stored.
alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_addressable;
alter table public.push_subscriptions
  add constraint push_subscriptions_addressable check (
    (platform = 'web' and endpoint is not null and subscription is not null)
    or
    (platform = 'ios' and device_token is not null)
  );

-- endpoint already has a unique constraint, and NULLs don't collide in a
-- Postgres unique index, so iOS rows coexist with it. device_token needs the
-- same treatment: one row per device, partial so web rows don't all collide
-- on NULL under a plain unique index.
create unique index if not exists push_subscriptions_device_token_key
  on public.push_subscriptions (device_token)
  where device_token is not null;

-- RLS is already correct: policy "own push subs" is ALL with
-- auth.uid() = user_id on both USING and WITH CHECK. Nothing to add.

-- ---------------------------------------------------------------------------
-- Group messages produce notifications
-- ---------------------------------------------------------------------------

-- messages has had on_message_notify since the beginning; group_messages only
-- ever had bump_sent. So a group message has never produced a notification —
-- not a push, not even the in-app bell.
create or replace function public.notify_on_group_message()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  sender      uuid;
  sender_name text;
  group_name  text;
begin
  -- group_messages.sender_id and .user_id are text, not uuid, and bump_sent_group
  -- already guards against junk in them. Same guard here: a bad id must not take
  -- down the message insert.
  begin
    sender := coalesce(new.sender_id, new.user_id)::uuid;
  exception when others then
    return new;
  end;

  if sender is null or new.group_id is null then
    return new;
  end if;

  select username into sender_name from public.profiles where id = sender;
  select name     into group_name  from public.groups   where id = new.group_id;

  -- Fan out to the members, minus the person who just typed it.
  insert into public.notifications (user_id, sender_id, title, body, chat_id)
  select
    gm.user_id,
    sender,
    coalesce(group_name, 'Group') || ' · ' || coalesce(sender_name, 'Someone'),
    case
      when new.type = 'image' then 'Sent a GIF'
      else left(coalesce(new.content, ''), 120)
    end,
    new.group_id::text
  from public.group_members gm
  where gm.group_id = new.group_id
    and gm.user_id is distinct from sender;

  return new;
end;
$$;

drop trigger if exists on_group_message_notify on public.group_messages;
create trigger on_group_message_notify
  after insert on public.group_messages
  for each row execute function public.notify_on_group_message();

-- ---------------------------------------------------------------------------
-- Every notification row is handed to the sender
-- ---------------------------------------------------------------------------

-- Both DMs and groups already funnel into notifications, so hanging the push
-- off this table means one dispatch path rather than one per message type —
-- and anything else that inserts a notification later gets push for free.
--
-- Only the id goes over the wire. The function reads the row back with its own
-- service role, so a caller who somehow reached the endpoint can't dictate the
-- title and body of a push to an arbitrary user.
create or replace function public.dispatch_push()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  fn_url  text;
  fn_key  text;
begin
  select decrypted_secret into fn_url from vault.decrypted_secrets where name = 'send_push_url';
  select decrypted_secret into fn_key from vault.decrypted_secrets where name = 'send_push_secret';

  -- Not configured yet: the app keeps working, it just doesn't push. This is
  -- what makes the migration safe to apply before the secrets exist.
  if fn_url is null or fn_key is null then
    return new;
  end if;

  perform net.http_post(
    url     := fn_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-push-secret', fn_key
               ),
    body    := jsonb_build_object('notification_id', new.id)
  );

  return new;
exception when others then
  -- A push that fails to dispatch must never roll back the message that caused
  -- it. The notification row is already committed; the bell still works.
  return new;
end;
$$;

drop trigger if exists on_notification_push on public.notifications;
create trigger on_notification_push
  after insert on public.notifications
  for each row execute function public.dispatch_push();
