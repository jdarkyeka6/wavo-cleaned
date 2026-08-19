-- Fix iOS APNs subscription registration.
--
-- The previous device_token index was partial (`where device_token is not null`).
-- Supabase/PostgREST upserts using `onConflict: 'device_token'` cannot infer that
-- partial index without the predicate, which caused:
--   there is no unique or exclusion constraint matching the ON CONFLICT specification
--
-- A normal UNIQUE constraint is correct here because PostgreSQL UNIQUE permits
-- multiple NULL values by default, so web rows can still leave device_token null.

drop index if exists public.push_subscriptions_device_token_key;

alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_device_token_key;

alter table public.push_subscriptions
  add constraint push_subscriptions_device_token_key unique (device_token);

-- Native iOS cannot reliably delete its old APNs row at logout because the token
-- is delivered asynchronously by Capacitor. If another Wavo account later signs
-- in on the same device, a normal client-side upsert can hit RLS because the old
-- row is owned by the previous account.
--
-- Keep the table RLS strict and expose one narrow RPC instead. The caller may only
-- claim the exact APNs token it presents, and the new owner is always auth.uid().
create or replace function public.claim_ios_push_subscription(
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
    'ios',
    btrim(p_device_token),
    null,
    null,
    left(p_user_agent, 200),
    now()
  )
  on conflict (device_token) do update
    set user_id = auth.uid(),
        platform = 'ios',
        endpoint = null,
        subscription = null,
        user_agent = left(excluded.user_agent, 200),
        last_seen_at = now()
  returning id into sub_id;

  return sub_id;
end;
$$;

revoke all on function public.claim_ios_push_subscription(text, text) from public;
grant execute on function public.claim_ios_push_subscription(text, text) to authenticated;
