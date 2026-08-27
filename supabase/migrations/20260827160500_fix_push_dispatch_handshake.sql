-- Align the database push trigger with supabase/functions/send-push/index.ts.
--
-- send-push deliberately accepts only a random, one-use dispatch id. The old
-- trigger still posted notification_id directly and the queue table did not
-- exist in the repo, so every push dispatch failed before APNs/Web Push could
-- even be attempted.

create table if not exists public.push_dispatch_queue (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists push_dispatch_queue_created_at_idx
  on public.push_dispatch_queue (created_at);

alter table public.push_dispatch_queue enable row level security;

-- This is an internal handoff table. Normal app clients never need to read,
-- create, update, or delete dispatch rows. send-push uses the service role and
-- therefore can atomically consume them despite RLS.
revoke all on table public.push_dispatch_queue from anon, authenticated;

create or replace function public.dispatch_push()
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
  select decrypted_secret
    into fn_url
    from vault.decrypted_secrets
   where name = 'send_push_url';

  select decrypted_secret
    into fn_key
    from vault.decrypted_secrets
   where name = 'send_push_secret';

  -- Push setup is optional. A missing URL must never break message delivery.
  if fn_url is null then
    return new;
  end if;

  -- Keep the one-use queue from accumulating forever if a network outage stops
  -- an Edge Function invocation from consuming an old row.
  delete from public.push_dispatch_queue
   where created_at < now() - interval '1 day';

  insert into public.push_dispatch_queue (notification_id)
  values (new.id)
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
  -- Push must be best-effort. Never roll back the notification/message because
  -- APNs, pg_net, Vault, or the Edge Function is temporarily unavailable.
  return new;
end;
$$;

drop trigger if exists on_notification_push on public.notifications;
create trigger on_notification_push
  after insert on public.notifications
  for each row execute function public.dispatch_push();
