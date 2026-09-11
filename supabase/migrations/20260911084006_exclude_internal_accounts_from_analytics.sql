alter table public.profiles
  add column if not exists is_internal boolean not null default false;

create index if not exists profiles_is_internal_idx on public.profiles (is_internal);

update public.profiles
set is_internal = true
where lower(username) in (
  'jake',
  'admin',
  'test',
  'test1',
  'test3',
  'testing',
  'wavo',
  'hudson67'
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uname text;
  bday date;
  internal_account boolean := false;
begin
  uname := coalesce(
    nullif(new.raw_user_meta_data->>'username', ''),
    split_part(new.email, '@', 1)
  );

  internal_account := lower(coalesce(new.raw_user_meta_data->>'is_internal', 'false')) in ('true', '1', 'yes');

  if uname ~* '^test:' then
    internal_account := true;
    uname := btrim(substring(uname from 6));
  end if;

  if uname is null or uname = '' then
    uname := split_part(new.email, '@', 1);
  end if;

  begin
    bday := nullif(new.raw_user_meta_data->>'birthday', '')::date;
  exception when others then
    bday := null;
  end;

  insert into public.profiles (
    id,
    username,
    first_name,
    last_name,
    email,
    birthday,
    age,
    is_admin,
    is_internal
  )
  values (
    new.id,
    uname,
    nullif(new.raw_user_meta_data->>'first_name', ''),
    nullif(new.raw_user_meta_data->>'last_name', ''),
    nullif(new.raw_user_meta_data->>'real_email', ''),
    bday,
    case when bday is not null
         then extract(year from age(bday))::int
         else null end,
    false,
    internal_account
  )
  on conflict (id) do nothing;

  return new;
end;
$function$;

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
    select count(distinct al.user_id) into cur_count
    from public.activity_log al
    join public.profiles p on p.id = al.user_id
    where al.day = streak_day
      and p.is_internal = false
      and coalesce(p.is_fictional_character, false) = false;

    select count(distinct al.user_id) into prev_count
    from public.activity_log al
    join public.profiles p on p.id = al.user_id
    where al.day = streak_day - 1
      and p.is_internal = false
      and coalesce(p.is_fictional_character, false) = false;

    exit when cur_count = 0;
    exit when cur_count < prev_count;
    streak := streak + 1;
    streak_day := streak_day - 1;
    exit when streak > 60;
  end loop;

  with real_profiles as (
    select *
    from public.profiles
    where is_internal = false
      and coalesce(is_fictional_character, false) = false
  ),
  real_activity as (
    select al.user_id, al.day
    from public.activity_log al
    join real_profiles p on p.id = al.user_id
  ),
  all_msgs as (
    select m.created_at, m.sender_id::text as sender
    from public.messages m
    join real_profiles p on p.id = m.sender_id
    where m.deleted_at is null

    union all

    select gm.created_at, coalesce(gm.sender_id, gm.user_id)::text as sender
    from public.group_messages gm
    join real_profiles p on p.id::text = coalesce(gm.sender_id, gm.user_id)::text
    where gm.deleted_at is null
  ),
  msg_days as (
    select (created_at at time zone 'Australia/Perth')::date as msg_day, sender
    from all_msgs
  )
  select jsonb_build_object(
    'total_users', (select count(*) from real_profiles),
    'internal_users', (select count(*) from public.profiles where is_internal = true or coalesce(is_fictional_character, false) = true),
    'dau', greatest(
      (select count(distinct user_id) from real_activity where day = perth_today),
      (select count(*) from real_profiles
        where last_active is not null
          and (last_active at time zone 'Australia/Perth')::date = perth_today)
    ),
    'dau_yesterday', (select count(distinct user_id) from real_activity where day = perth_today - 1),
    'wau', greatest(
      (select count(distinct user_id) from real_activity where day > perth_today - 7),
      (select count(*) from real_profiles
        where last_active is not null
          and (last_active at time zone 'Australia/Perth')::date > perth_today - 7)
    ),
    'mau', greatest(
      (select count(distinct user_id) from real_activity where day > perth_today - 30),
      (select count(*) from real_profiles
        where last_active is not null
          and (last_active at time zone 'Australia/Perth')::date > perth_today - 30)
    ),
    'new_users_today', (select count(*) from real_profiles
      where (created_at at time zone 'Australia/Perth')::date = perth_today),
    'new_users_week', (select count(*) from real_profiles
      where (created_at at time zone 'Australia/Perth')::date > perth_today - 7),
    'inactive_7d', (select count(*) from real_profiles
      where last_active is null
         or (last_active at time zone 'Australia/Perth')::date <= perth_today - 7),
    'messages_today', (select count(*) from msg_days where msg_day = perth_today),
    'messages_yesterday', (select count(*) from msg_days where msg_day = perth_today - 1),
    'messages_week', (select count(*) from msg_days where msg_day > perth_today - 7),
    'avg_messages_7d', round((select count(*) from msg_days where msg_day > perth_today - 7) / 7.0, 1),
    'total_messages', (select count(*) from all_msgs),
    'avg_messages_per_user', case when (select count(*) from real_profiles) > 0
      then round((select count(*) from all_msgs)::numeric / (select count(*) from real_profiles), 1)
      else 0 end,
    'senders_today', (select count(distinct sender) from msg_days where msg_day = perth_today),
    'groups_total', (
      select count(*)
      from public.groups g
      where not exists (
        select 1 from public.profiles p
        where p.id::text = g.created_by
          and (p.is_internal = true or coalesce(p.is_fictional_character, false) = true)
      )
    ),
    'active_groups_7d', (
      select count(distinct gm.group_id)
      from public.group_messages gm
      join real_profiles p on p.id::text = coalesce(gm.sender_id, gm.user_id)::text
      where gm.deleted_at is null
        and (gm.created_at at time zone 'Australia/Perth')::date > perth_today - 7
    ),
    'friendships', (
      select count(*)
      from public.friend_requests fr
      join real_profiles s on s.id = fr.sender_id
      join real_profiles r on r.id = fr.receiver_id
      where fr.status = 'accepted'
    ),
    'group_leaderboard', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
        select g.name, count(*)::int as messages
        from public.group_messages gm
        join public.groups g on g.id = gm.group_id
        join real_profiles p on p.id::text = coalesce(gm.sender_id, gm.user_id)::text
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
      join real_profiles p on p.id::text = coalesce(gm.sender_id, gm.user_id)::text
      where gm.deleted_at is null
        and (gm.created_at at time zone 'Australia/Perth')::date > perth_today - 7
      group by g.id, g.name
      order by count(*) desc
      limit 1
    ),
    'plans_week', (
      select count(*)
      from public.plans pl
      join real_profiles p on p.id = pl.created_by
      where (pl.created_at at time zone 'Australia/Perth')::date > perth_today - 7
    ),
    'games_week', (
      select count(*)
      from public.games ga
      join real_profiles p on p.id::text = ga.created_by
      where (ga.created_at at time zone 'Australia/Perth')::date > perth_today - 7
    ),
    'premium_users', (select count(*) from real_profiles where is_premium = true),
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
        select day, count(distinct user_id) as c
        from real_activity
        group by day
      ) a on a.day = gs.history_day
    )
  ) into result;

  return result;
end;
$function$;

revoke all on function public.get_founder_stats() from public;
grant execute on function public.get_founder_stats() to authenticated;
