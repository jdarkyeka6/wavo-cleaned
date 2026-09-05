-- Wavo 1:1 video-call base.
-- Call metadata is short lived; audio/video never passes through Postgres.

create table if not exists public.call_sessions (
  id uuid primary key default gen_random_uuid(),
  caller_id uuid not null references public.profiles(id) on delete cascade,
  callee_id uuid not null references public.profiles(id) on delete cascade,
  mode text not null default 'video' check (mode in ('voice', 'video')),
  status text not null default 'ringing' check (status in ('ringing', 'active', 'declined', 'ended', 'missed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  constraint call_sessions_distinct_people check (caller_id <> callee_id)
);

create index if not exists call_sessions_callee_status_created_idx
  on public.call_sessions (callee_id, status, created_at desc);

create index if not exists call_sessions_caller_status_created_idx
  on public.call_sessions (caller_id, status, created_at desc);

alter table public.call_sessions enable row level security;

drop policy if exists "call participants can read" on public.call_sessions;
create policy "call participants can read"
  on public.call_sessions
  for select
  to authenticated
  using (auth.uid() = caller_id or auth.uid() = callee_id);

drop policy if exists "friends can start calls" on public.call_sessions;
create policy "friends can start calls"
  on public.call_sessions
  for insert
  to authenticated
  with check (
    auth.uid() = caller_id
    and caller_id <> callee_id
    and public.are_friends(caller_id, callee_id)
    and not public.blocked_between(caller_id, callee_id)
  );

drop policy if exists "call participants can update" on public.call_sessions;
create policy "call participants can update"
  on public.call_sessions
  for update
  to authenticated
  using (auth.uid() = caller_id or auth.uid() = callee_id)
  with check (auth.uid() = caller_id or auth.uid() = callee_id);

create or replace function public.touch_call_session_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists call_sessions_touch_updated_at on public.call_sessions;
create trigger call_sessions_touch_updated_at
before update on public.call_sessions
for each row execute function public.touch_call_session_updated_at();

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'call_sessions'
  ) then
    alter publication supabase_realtime add table public.call_sessions;
  end if;
end;
$$;

drop policy if exists "call participants can send realtime signals" on realtime.messages;
create policy "call participants can send realtime signals"
  on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.topic() like 'wavo-call:%'
    and exists (
      select 1
      from public.call_sessions c
      where c.id::text = split_part(realtime.topic(), ':', 2)
        and (auth.uid() = c.caller_id or auth.uid() = c.callee_id)
        and c.status in ('ringing', 'active')
        and c.expires_at > now()
    )
  );

drop policy if exists "call participants can receive realtime signals" on realtime.messages;
create policy "call participants can receive realtime signals"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.topic() like 'wavo-call:%'
    and exists (
      select 1
      from public.call_sessions c
      where c.id::text = split_part(realtime.topic(), ':', 2)
        and (auth.uid() = c.caller_id or auth.uid() = c.callee_id)
        and c.status in ('ringing', 'active')
        and c.expires_at > now()
    )
  );
