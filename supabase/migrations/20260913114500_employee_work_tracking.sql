-- Employee work tracking for Wavo QA/testing staff.
-- Tracks only whether the Wavo browser window is focused, idle or away while
-- the employee has explicitly started a work session.

alter table public.profiles
  add column if not exists is_employee boolean not null default false;

comment on column public.profiles.is_employee is
  'Admin-controlled flag. Employees can explicitly start/stop Wavo work tracking.';

-- Role-like profile fields must not be self-assignable from a browser client.
create schema if not exists private;

create or replace function private.protect_profile_staff_flags()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := (select auth.uid());
begin
  if caller_id is not null
     and (
       new.is_admin is distinct from old.is_admin
       or new.is_employee is distinct from old.is_employee
     )
     and not public.is_admin(caller_id)
  then
    raise exception 'Only administrators can change staff roles'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.protect_profile_staff_flags() from public, anon, authenticated;

drop trigger if exists protect_profile_staff_flags on public.profiles;
create trigger protect_profile_staff_flags
before update of is_admin, is_employee on public.profiles
for each row execute function private.protect_profile_staff_flags();

create table if not exists public.employee_work_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  focused_seconds integer not null default 0 check (focused_seconds >= 0),
  idle_seconds integer not null default 0 check (idle_seconds >= 0),
  away_seconds integer not null default 0 check (away_seconds >= 0),
  last_heartbeat_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint employee_work_sessions_end_after_start
    check (ended_at is null or ended_at >= started_at)
);

comment on table public.employee_work_sessions is
  'Explicit employee work sessions. Focus counters describe Wavo window state only; they do not identify other apps/sites.';

create unique index if not exists employee_work_sessions_one_active_per_user
  on public.employee_work_sessions(user_id)
  where ended_at is null;

create index if not exists employee_work_sessions_user_started_idx
  on public.employee_work_sessions(user_id, started_at desc);

alter table public.employee_work_sessions enable row level security;

revoke all on table public.employee_work_sessions from anon;
revoke insert, update, delete on table public.employee_work_sessions from authenticated;
grant select on table public.employee_work_sessions to authenticated;

drop policy if exists "Employees can view own work sessions" on public.employee_work_sessions;
create policy "Employees can view own work sessions"
on public.employee_work_sessions
for select
to authenticated
using (
  (select auth.uid()) = user_id
  or public.is_admin((select auth.uid()))
);

-- Mutations happen through narrow RPCs so the browser cannot directly rewrite
-- its accumulated counters or another user's session.
create or replace function public.start_employee_work_session()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := (select auth.uid());
  work_row public.employee_work_sessions%rowtype;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = caller_id and p.is_employee = true
  ) then
    raise exception 'Employee access required' using errcode = '42501';
  end if;

  select * into work_row
  from public.employee_work_sessions
  where user_id = caller_id and ended_at is null
  order by started_at desc
  limit 1;

  if found then
    return to_jsonb(work_row);
  end if;

  begin
    insert into public.employee_work_sessions(user_id)
    values (caller_id)
    returning * into work_row;
  exception when unique_violation then
    select * into work_row
    from public.employee_work_sessions
    where user_id = caller_id and ended_at is null
    order by started_at desc
    limit 1;
  end;

  return to_jsonb(work_row);
end;
$$;

create or replace function public.record_employee_work_heartbeat(
  p_session_id uuid,
  p_state text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := (select auth.uid());
  now_at timestamptz := clock_timestamp();
  work_row public.employee_work_sessions%rowtype;
  elapsed_seconds integer;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_state not in ('focused', 'idle', 'away') then
    raise exception 'Invalid work state' using errcode = '22023';
  end if;

  select * into work_row
  from public.employee_work_sessions
  where id = p_session_id
    and user_id = caller_id
    and ended_at is null
  for update;

  if not found then
    raise exception 'Active work session not found' using errcode = 'P0002';
  end if;

  elapsed_seconds := greatest(
    0,
    floor(extract(epoch from (now_at - work_row.last_heartbeat_at)))::integer
  );

  update public.employee_work_sessions
  set focused_seconds = focused_seconds + case when p_state = 'focused' then elapsed_seconds else 0 end,
      idle_seconds = idle_seconds + case when p_state = 'idle' then elapsed_seconds else 0 end,
      away_seconds = away_seconds + case when p_state = 'away' then elapsed_seconds else 0 end,
      last_heartbeat_at = now_at
  where id = p_session_id
  returning * into work_row;

  return to_jsonb(work_row);
end;
$$;

create or replace function public.stop_employee_work_session(
  p_session_id uuid,
  p_state text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := (select auth.uid());
  now_at timestamptz := clock_timestamp();
  work_row public.employee_work_sessions%rowtype;
  elapsed_seconds integer;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_state not in ('focused', 'idle', 'away') then
    raise exception 'Invalid work state' using errcode = '22023';
  end if;

  select * into work_row
  from public.employee_work_sessions
  where id = p_session_id
    and user_id = caller_id
    and ended_at is null
  for update;

  if not found then
    raise exception 'Active work session not found' using errcode = 'P0002';
  end if;

  elapsed_seconds := greatest(
    0,
    floor(extract(epoch from (now_at - work_row.last_heartbeat_at)))::integer
  );

  update public.employee_work_sessions
  set focused_seconds = focused_seconds + case when p_state = 'focused' then elapsed_seconds else 0 end,
      idle_seconds = idle_seconds + case when p_state = 'idle' then elapsed_seconds else 0 end,
      away_seconds = away_seconds + case when p_state = 'away' then elapsed_seconds else 0 end,
      last_heartbeat_at = now_at,
      ended_at = now_at
  where id = p_session_id
  returning * into work_row;

  return to_jsonb(work_row);
end;
$$;

revoke all on function public.start_employee_work_session() from public, anon;
revoke all on function public.record_employee_work_heartbeat(uuid, text) from public, anon;
revoke all on function public.stop_employee_work_session(uuid, text) from public, anon;

grant execute on function public.start_employee_work_session() to authenticated;
grant execute on function public.record_employee_work_heartbeat(uuid, text) to authenticated;
grant execute on function public.stop_employee_work_session(uuid, text) to authenticated;

-- If an admin removes employee status (including directly in Supabase), close
-- any forgotten active timer and count the unobserved tail as away from Wavo.
create or replace function private.close_employee_session_on_disable()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  now_at timestamptz := clock_timestamp();
begin
  if old.is_employee = true and new.is_employee = false then
    update public.employee_work_sessions
    set away_seconds = away_seconds + greatest(
          0,
          floor(extract(epoch from (now_at - last_heartbeat_at)))::integer
        ),
        last_heartbeat_at = now_at,
        ended_at = now_at
    where user_id = new.id and ended_at is null;
  end if;

  return new;
end;
$$;

revoke all on function private.close_employee_session_on_disable() from public, anon, authenticated;

drop trigger if exists close_employee_session_on_disable on public.profiles;
create trigger close_employee_session_on_disable
after update of is_employee on public.profiles
for each row execute function private.close_employee_session_on_disable();
