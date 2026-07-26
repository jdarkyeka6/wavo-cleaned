-- Streaks were unreliable because the two functions that record activity
-- disagreed about what day it is.
--
--   ping_activity()  used (now() at time zone 'Australia/Perth')::date
--   touch_activity() used current_date, which is UTC (the DB runs in UTC)
--
-- Perth is UTC+8, so between midnight and 08:00 Perth time the UTC date is
-- still yesterday. Depending on what time of day someone opened Wavo, the
-- same Perth day could be counted twice, or a genuinely new day could be
-- skipped and the streak silently fail to advance.
--
-- Everything now goes through one definition of "today" and one piece of
-- streak arithmetic.

create or replace function public.wavo_today()
returns date
language sql
stable
set search_path to 'public'
as $$ select (now() at time zone 'Australia/Perth')::date $$;

-- Core accounting. Takes a uid so triggers can call it for the row's author.
-- NOT exposed over PostgREST (see the revoke below) — it must not be callable
-- with someone else's id.
create or replace function public.record_activity(p_uid uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  today date := public.wavo_today();
  last  date;
begin
  if p_uid is null then return; end if;

  insert into public.user_stats (user_id, days_active, current_streak, longest_streak, last_active)
  values (p_uid, 1, 1, 1, today)
  on conflict (user_id) do nothing;

  select last_active into last from public.user_stats where user_id = p_uid;

  if last is null then
    -- Row already existed but had never recorded a day (e.g. it was created
    -- by the messages_sent trigger before this user ever opened the app).
    update public.user_stats set
      days_active    = greatest(days_active, 1),
      current_streak = greatest(current_streak, 1),
      longest_streak = greatest(longest_streak, 1),
      last_active    = today,
      updated_at     = now()
    where user_id = p_uid;
  elsif last >= today then
    return;                              -- already counted today
  elsif last = today - 1 then
    update public.user_stats set
      days_active    = days_active + 1,
      current_streak = current_streak + 1,
      longest_streak = greatest(longest_streak, current_streak + 1),
      last_active    = today,
      updated_at     = now()
    where user_id = p_uid;
  else
    update public.user_stats set
      days_active    = days_active + 1,
      current_streak = 1,
      longest_streak = greatest(longest_streak, 1),
      last_active    = today,
      updated_at     = now()
    where user_id = p_uid;
  end if;
end; $$;

revoke all on function public.record_activity(uuid) from public;
revoke all on function public.record_activity(uuid) from anon;
revoke all on function public.record_activity(uuid) from authenticated;

-- Opening the app counts.
create or replace function public.touch_activity()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$ begin perform public.record_activity(auth.uid()); end; $$;

create or replace function public.ping_activity()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return; end if;
  insert into public.activity_log (user_id, day)
  values (uid, public.wavo_today())
  on conflict (user_id, day) do nothing;
  update public.profiles set last_active = now() where id = uid;
  perform public.record_activity(uid);
end; $$;

-- Sending a message counts too. Previously only the cosmetics hook on app
-- mount recorded a day, so if that fetch failed or was skipped you could
-- use Wavo all day and have it not register.
create or replace function public.bump_sent_dm()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.sender_id is null then return new; end if;
  insert into public.user_stats (user_id, messages_sent) values (new.sender_id, 1)
  on conflict (user_id) do update
    set messages_sent = public.user_stats.messages_sent + 1, updated_at = now();
  perform public.record_activity(new.sender_id);
  return new;
end; $$;

create or replace function public.bump_sent_group()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare uid uuid;
begin
  begin
    uid := coalesce(new.sender_id, new.user_id)::uuid;
  exception when others then
    return new;   -- junk id, don't blow up the insert
  end;
  if uid is null then return new; end if;
  insert into public.user_stats (user_id, messages_sent) values (uid, 1)
  on conflict (user_id) do update
    set messages_sent = public.user_stats.messages_sent + 1, updated_at = now();
  perform public.record_activity(uid);
  return new;
end; $$;
