-- Better streaks: a missed day no longer always wipes the run, and the client
-- can ask whether today still needs saving.
--
-- The timezone bug is already fixed (both writers go through wavo_today()).
-- What was left is that the streak was all-or-nothing and effectively
-- invisible: it lived on one line inside Settings, so the first you knew about
-- losing a 40-day run was seeing it read 1.

alter table public.user_stats
  add column if not exists streak_freezes int not null default 2;

alter table public.user_stats
  add column if not exists freezes_used int not null default 0;

-- Existing users start with the same two as everyone else.
update public.user_stats set streak_freezes = 2 where streak_freezes is null;

-- ---------------------------------------------------------------------------
-- record_activity, now with freezes
-- ---------------------------------------------------------------------------
create or replace function public.record_activity(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  today  date := public.wavo_today();
  last   date;
  gap    int;
  streak int;
  frozen int;
  next_streak int;
begin
  if p_uid is null then return; end if;

  insert into public.user_stats (user_id, days_active, current_streak, longest_streak, last_active)
  values (p_uid, 1, 1, 1, today)
  on conflict (user_id) do nothing;

  select last_active, current_streak, streak_freezes
    into last, streak, frozen
    from public.user_stats where user_id = p_uid;

  if last is null then
    -- Row existed but had never recorded a day (created by the messages_sent
    -- trigger before this user first opened the app).
    update public.user_stats set
      days_active    = greatest(days_active, 1),
      current_streak = greatest(current_streak, 1),
      longest_streak = greatest(longest_streak, 1),
      last_active    = today,
      updated_at     = now()
    where user_id = p_uid;
    return;
  end if;

  if last >= today then
    return;                                  -- already counted today
  end if;

  gap := today - last;

  if gap = 1 then
    next_streak := streak + 1;
  elsif gap = 2 and frozen > 0 then
    -- Missed exactly one day and has a freeze: spend it and carry on. Only
    -- one day can be covered — a two-day absence still resets, otherwise a
    -- stock of freezes would make the streak meaningless.
    next_streak := streak + 1;
    update public.user_stats set
      streak_freezes = streak_freezes - 1,
      freezes_used   = freezes_used + 1
    where user_id = p_uid;
  else
    next_streak := 1;
  end if;

  update public.user_stats set
    days_active    = days_active + 1,
    current_streak = next_streak,
    longest_streak = greatest(longest_streak, next_streak),
    last_active    = today,
    updated_at     = now()
  where user_id = p_uid;

  -- Earn one back every seventh day, up to three in hand.
  if next_streak % 7 = 0 then
    update public.user_stats set
      streak_freezes = least(streak_freezes + 1, 3)
    where user_id = p_uid;
  end if;
end $$;

revoke execute on function public.record_activity(uuid) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- What the client needs to render the streak honestly
-- ---------------------------------------------------------------------------
create or replace function public.get_streak_state()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'current_streak', coalesce(s.current_streak, 0),
    'longest_streak', coalesce(s.longest_streak, 0),
    'days_active',    coalesce(s.days_active, 0),
    'messages_sent',  coalesce(s.messages_sent, 0),
    'freezes',        coalesce(s.streak_freezes, 0),
    'last_active',    s.last_active,
    'today',          public.wavo_today(),
    -- counted today already?
    'active_today',   coalesce(s.last_active >= public.wavo_today(), false),
    -- a run that will break tonight unless they turn up
    'at_risk',        coalesce(
                        s.current_streak > 0
                        and s.last_active = public.wavo_today() - 1, false),
    -- hours left in the Perth day, for "ends in Nh"
    'hours_left',     ceil(
                        extract(epoch from (
                          ((public.wavo_today() + 1)::timestamp)
                          - (now() at time zone 'Australia/Perth')
                        )) / 3600.0
                      )
  )
  from public.user_stats s
  where s.user_id = auth.uid()
$$;

grant execute on function public.get_streak_state() to authenticated;
