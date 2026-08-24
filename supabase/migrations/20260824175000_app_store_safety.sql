-- Wavo App Store submission safety layer
-- This migration is already applied to the linked production project.

create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  category text not null default 'support'
    check (category in ('support', 'safety', 'privacy', 'account')),
  message text not null
    check (char_length(btrim(message)) between 5 and 4000),
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.support_requests enable row level security;
revoke all on table public.support_requests from anon;
grant select, insert on table public.support_requests to authenticated;

create policy "users create own support requests"
on public.support_requests for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "users read own support requests"
on public.support_requests for select to authenticated
using ((select auth.uid()) = user_id or is_admin((select auth.uid())));

create policy "admins update support requests"
on public.support_requests for update to authenticated
using (is_admin((select auth.uid())))
with check (is_admin((select auth.uid())));

create policy "admins delete support requests"
on public.support_requests for delete to authenticated
using (is_admin((select auth.uid())));

create schema if not exists private;

create or replace function private.wavo_content_allowed(input_text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(coalesce(input_text, '')) !~
    '(kill[[:space:]]+yourself|kys\y|send[[:space:]]+(me[[:space:]]+)?nudes?|child[[:space:]]+(porn|sexual)|rape[[:space:]]+(you|her|him)|n[i1]gg[ae]r|f[a@]gg[o0]t)';
$$;

revoke all on function private.wavo_content_allowed(text) from public;
grant execute on function private.wavo_content_allowed(text) to authenticated;

DO $$
BEGIN
  IF NOT EXISTS (select 1 from pg_constraint where conname = 'messages_content_safety') THEN
    alter table public.messages add constraint messages_content_safety
      check (private.wavo_content_allowed(content)) not valid;
  END IF;
  IF NOT EXISTS (select 1 from pg_constraint where conname = 'group_messages_content_safety') THEN
    alter table public.group_messages add constraint group_messages_content_safety
      check (private.wavo_content_allowed(content)) not valid;
  END IF;
  IF NOT EXISTS (select 1 from pg_constraint where conname = 'posts_content_safety') THEN
    alter table public.posts add constraint posts_content_safety
      check (private.wavo_content_allowed(body)) not valid;
  END IF;
  IF NOT EXISTS (select 1 from pg_constraint where conname = 'waves_content_safety') THEN
    alter table public.waves add constraint waves_content_safety
      check (private.wavo_content_allowed(body)) not valid;
  END IF;
END
$$;

create or replace function public.cleanup_account_for_deletion(target_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required';
  end if;

  delete from storage.objects
  where owner = target_user or owner_id = target_user::text;

  delete from public.group_messages
  where sender_id = target_user::text or user_id = target_user::text;

  delete from public.groups
  where created_by = target_user::text;

  if to_regclass('public.announcements') is not null then
    execute 'delete from public.announcements where created_by = $1'
      using target_user::text;
  end if;

  if to_regclass('public.games') is not null then
    execute 'delete from public.games where created_by = $1'
      using target_user::text;
  end if;
end;
$$;

revoke all on function public.cleanup_account_for_deletion(uuid) from public;
revoke all on function public.cleanup_account_for_deletion(uuid) from anon;
revoke all on function public.cleanup_account_for_deletion(uuid) from authenticated;
grant execute on function public.cleanup_account_for_deletion(uuid) to service_role;
