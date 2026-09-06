-- Keep Wavo calls from becoming stale/zombie sessions.
-- New unanswered calls expire after 45 seconds. A small pg_cron job makes the
-- database authoritative even if the caller's web view is suspended or dies.

alter table public.call_sessions
  alter column expires_at set default (now() + interval '45 seconds');

update public.call_sessions
   set expires_at = least(expires_at, created_at + interval '45 seconds')
 where status = 'ringing';

update public.call_sessions
   set status = 'missed'
 where status = 'ringing'
   and least(expires_at, created_at + interval '45 seconds') <= now();

create or replace function public.enforce_call_session_transition()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- A finished call must never be resurrected by a delayed client/realtime event.
  if old.status in ('declined', 'ended', 'missed', 'cancelled') then
    raise exception 'Call has already ended';
  end if;

  -- Do not allow an old ringing row to become active after its answer window.
  if old.status = 'ringing'
     and new.status = 'active'
     and least(old.expires_at, old.created_at + interval '45 seconds') <= now() then
    raise exception 'Call has expired';
  end if;

  -- Keep state transitions one-way and predictable.
  if old.status = 'active' and new.status not in ('ended', 'cancelled') then
    raise exception 'Invalid active call transition';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_call_session_transition() from public;

drop trigger if exists call_sessions_enforce_transition on public.call_sessions;
create trigger call_sessions_enforce_transition
before update of status on public.call_sessions
for each row execute function public.enforce_call_session_transition();

create or replace function public.expire_stale_ringing_calls()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update public.call_sessions
     set status = 'missed'
   where status = 'ringing'
     and least(expires_at, created_at + interval '45 seconds') <= now();

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.expire_stale_ringing_calls() from public;

create extension if not exists pg_cron;

do $$
declare
  existing_job bigint;
begin
  for existing_job in
    select jobid from cron.job where jobname = 'wavo-expire-stale-calls'
  loop
    perform cron.unschedule(existing_job);
  end loop;

  perform cron.schedule(
    'wavo-expire-stale-calls',
    '10 seconds',
    'select public.expire_stale_ringing_calls();'
  );
end;
$$;
