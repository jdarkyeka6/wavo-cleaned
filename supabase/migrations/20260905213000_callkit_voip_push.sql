-- Native iOS incoming-call delivery for Wavo CallKit.
--
-- Normal APNs alert tokens stay platform='ios'. PushKit creates a separate
-- VoIP token, stored as platform='ios_voip', so call pushes can use the APNs
-- VoIP topic without changing message-notification behaviour.

alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_platform_check;
alter table public.push_subscriptions
  add constraint push_subscriptions_platform_check
  check (platform in ('web', 'ios', 'ios_voip'));

alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_addressable;
alter table public.push_subscriptions
  add constraint push_subscriptions_addressable check (
    (platform = 'web' and endpoint is not null and subscription is not null)
    or
    (platform in ('ios', 'ios_voip') and device_token is not null)
  );

create or replace function public.claim_ios_voip_push_subscription(
  p_device_token text,
  p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  sub_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if length(btrim(coalesce(p_device_token, ''))) = 0 then
    raise exception 'Missing device token';
  end if;

  insert into public.push_subscriptions (
    user_id,
    platform,
    device_token,
    endpoint,
    subscription,
    user_agent,
    last_seen_at
  ) values (
    auth.uid(),
    'ios_voip',
    btrim(p_device_token),
    null,
    null,
    left(p_user_agent, 200),
    now()
  )
  on conflict (device_token) do update
    set user_id = auth.uid(),
        platform = 'ios_voip',
        endpoint = null,
        subscription = null,
        user_agent = left(excluded.user_agent, 200),
        last_seen_at = now()
  returning id into sub_id;

  return sub_id;
end;
$$;

revoke all on function public.claim_ios_voip_push_subscription(text, text) from public;
grant execute on function public.claim_ios_voip_push_subscription(text, text) to authenticated;

create or replace function public.release_ios_voip_push_subscription(
  p_device_token text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  removed_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if length(btrim(coalesce(p_device_token, ''))) = 0 then
    return false;
  end if;

  delete from public.push_subscriptions
   where user_id = auth.uid()
     and platform = 'ios_voip'
     and device_token = btrim(p_device_token);

  get diagnostics removed_count = row_count;
  return removed_count > 0;
end;
$$;

revoke all on function public.release_ios_voip_push_subscription(text) from public;
grant execute on function public.release_ios_voip_push_subscription(text) to authenticated;

-- The existing one-use queue normally points at a notification row. CallKit
-- also needs a tiny server event when a ringing/active call ends so a lock-screen
-- incoming-call UI disappears immediately even when Wavo's web view is asleep.
alter table public.push_dispatch_queue
  alter column notification_id drop not null;
alter table public.push_dispatch_queue
  add column if not exists call_event jsonb;

alter table public.push_dispatch_queue
  drop constraint if exists push_dispatch_queue_payload_check;
alter table public.push_dispatch_queue
  add constraint push_dispatch_queue_payload_check check (
    (notification_id is not null) <> (call_event is not null)
  );

create or replace function public.dispatch_call_voip_update()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  fn_url      text;
  fn_key      text;
  dispatch_id uuid;
begin
  if new.status is not distinct from old.status
     or new.status not in ('declined', 'ended', 'missed', 'cancelled') then
    return new;
  end if;

  select decrypted_secret
    into fn_url
    from vault.decrypted_secrets
   where name = 'send_push_url';

  select decrypted_secret
    into fn_key
    from vault.decrypted_secrets
   where name = 'send_push_secret';

  if fn_url is null then
    return new;
  end if;

  delete from public.push_dispatch_queue
   where created_at < now() - interval '1 day';

  insert into public.push_dispatch_queue (call_event)
  values (jsonb_build_object(
    'kind', 'call_end',
    'user_id', new.callee_id,
    'call_id', new.id,
    'status', new.status
  ))
  returning id into dispatch_id;

  perform net.http_post(
    url     := fn_url,
    headers := jsonb_strip_nulls(
      jsonb_build_object(
        'Content-Type', 'application/json',
        'x-push-secret', fn_key
      )
    ),
    body    := jsonb_build_object('dispatch_id', dispatch_id)
  );

  return new;
exception when others then
  -- Call state must never fail because APNs/pg_net is temporarily unavailable.
  return new;
end;
$$;

drop trigger if exists on_call_voip_terminal_push on public.call_sessions;
create trigger on_call_voip_terminal_push
  after update of status on public.call_sessions
  for each row execute function public.dispatch_call_voip_update();
