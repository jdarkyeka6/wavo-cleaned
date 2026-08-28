create table if not exists public.admin_actions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete cascade,
  action text not null,
  target_user_id uuid null references public.profiles(id) on delete set null,
  detail text null,
  created_at timestamptz not null default now()
);

create index if not exists admin_actions_created_at_idx on public.admin_actions (created_at desc);
create index if not exists admin_actions_actor_id_idx on public.admin_actions (actor_id);
create index if not exists admin_actions_target_user_id_idx on public.admin_actions (target_user_id);

alter table public.admin_actions enable row level security;

drop policy if exists "Admins can view admin actions" on public.admin_actions;
create policy "Admins can view admin actions"
on public.admin_actions
for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_admin = true
  )
);

drop policy if exists "Admins can create admin actions" on public.admin_actions;
create policy "Admins can create admin actions"
on public.admin_actions
for insert
to authenticated
with check (
  actor_id = auth.uid()
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_admin = true
  )
);

grant select, insert on public.admin_actions to authenticated;

create or replace function public.get_founder_stats()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  perth_today date := (now() at time zone 'Australia/Perth')::date;
  result jsonb;
  streak int := 0;
  streak_day date;
  prev_count int;
  cur_count int;
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and is_admin = true
  ) then
    raise exception 'Not authorized';
  end if;

  streak_day := perth_today - 1;
  loop
    select count(*) into cur_count from public.activity_log where day = streak_day;
    select count(*) into prev_count from public.activity_log where day = streak_day - 1;
    exit when cur_count = 0;
    exit when cur_count < prev_count;
    streak := streak + 1;
    streak_day := streak_day - 1;
    exit when streak > 60;
  end loop;

  with all_msgs as (
    select created_at, sender_id::text as sender
      from public.messages where deleted_at is null
    union all
    select created_at, coalesce(sender_id, user_id)::text as sender
      from public.group_messages where deleted_at is null
  ),
  msg_days as (
    select (created_at at time zone 'Australia/Perth')::date as msg_day, sender
    from all_msgs
  )
  select jsonb_build_object(
    'total_users', (select count(*) from public.profiles),
    'dau', greatest(
      (select count(distinct user_id) from public.activity_log where day = perth_today),
      (select count(*) from public.profiles
        where last_active is not null
          and (last_active at time zone 'Australia/Perth')::date = perth_today)
    ),
    'dau_yesterday', (select count(distinct user_id) from public.activity_log where day = perth_today - 1),
    'wau', greatest(
      (select count(distinct user_id) from public.activity_log where day > perth_today - 7),
      (select count(*) from public.profiles
        where last_active is not null
          and (last_active at time zone 'Australia/Perth')::date > perth_today - 7)
    ),
    'mau', greatest(
      (select count(distinct user_id) from public.activity_log where day > perth_today - 30),
      (select count(*) from public.profiles
        where last_active is not null
          and (last_active at time zone 'Australia/Perth')::date > perth_today - 30)
    ),
    'new_users_today', (select count(*) from public.profiles
      where (created_at at time zone 'Australia/Perth')::date = perth_today),
    'new_users_week', (select count(*) from public.profiles
      where (created_at at time zone 'Australia/Perth')::date > perth_today - 7),
    'inactive_7d', (select count(*) from public.profiles
      where last_active is null
         or (last_active at time zone 'Australia/Perth')::date <= perth_today - 7),
    'messages_today', (select count(*) from msg_days where msg_day = perth_today),
    'messages_yesterday', (select count(*) from msg_days where msg_day = perth_today - 1),
    'messages_week', (select count(*) from msg_days where msg_day > perth_today - 7),
    'avg_messages_7d', round((select count(*) from msg_days where msg_day > perth_today - 7) / 7.0, 1),
    'total_messages', (select count(*) from all_msgs),
    'avg_messages_per_user', case when (select count(*) from public.profiles) > 0
      then round((select count(*) from all_msgs)::numeric / (select count(*) from public.profiles), 1)
      else 0 end,
    'senders_today', (select count(distinct sender) from msg_days where msg_day = perth_today),
    'groups_total', (select count(*) from public.groups),
    'active_groups_7d', (select count(distinct group_id) from public.group_messages
      where deleted_at is null
        and (created_at at time zone 'Australia/Perth')::date > perth_today - 7),
    'friendships', (select count(*) from public.friend_requests where status = 'accepted'),
    'group_leaderboard', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
        select g.name, count(*)::int as messages
        from public.group_messages gm
        join public.groups g on g.id = gm.group_id
        where gm.deleted_at is null
        group by g.name
        order by count(*) desc
        limit 5
      ) t
    ),
    'most_active_group', (
      select g.name
      from public.group_messages gm
      join public.groups g on g.id = gm.group_id
      where gm.deleted_at is null
        and (gm.created_at at time zone 'Australia/Perth')::date > perth_today - 7
      group by g.id, g.name
      order by count(*) desc
      limit 1
    ),
    'plans_week', (select count(*) from public.plans
      where (created_at at time zone 'Australia/Perth')::date > perth_today - 7),
    'games_week', (select count(*) from public.games
      where (created_at at time zone 'Australia/Perth')::date > perth_today - 7),
    'premium_users', (select count(*) from public.profiles where is_premium = true),
    'healthy_streak', streak,
    'dau_history', (
      select coalesce(
        jsonb_agg(jsonb_build_object('day', gs.history_day, 'count', coalesce(a.c, 0)) order by gs.history_day),
        '[]'::jsonb
      )
      from (
        select generate_series(perth_today - 13, perth_today, interval '1 day')::date as history_day
      ) gs
      left join (
        select day, count(distinct user_id) as c from public.activity_log group by day
      ) a on a.day = gs.history_day
    )
  ) into result;

  return result;
end;
$function$;

revoke all on function public.get_founder_stats() from public;
grant execute on function public.get_founder_stats() to authenticated;
