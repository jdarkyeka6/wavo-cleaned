-- Batch 2: small-group WebRTC video calls for Wavo Spaces.
-- Media stays peer-to-peer. Postgres only stores room/member metadata.

create table if not exists public.group_call_rooms (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'active' check (status in ('active','ended')),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  expires_at timestamptz not null default (now() + interval '2 hours')
);

create unique index if not exists group_call_one_active_per_space_idx
  on public.group_call_rooms(group_id)
  where status = 'active';

create index if not exists group_call_rooms_active_idx
  on public.group_call_rooms(group_id, created_at desc)
  where status = 'active';

create table if not exists public.group_call_members (
  room_id uuid not null references public.group_call_rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index if not exists group_call_members_user_idx
  on public.group_call_members(user_id, joined_at desc);

alter table public.group_call_rooms enable row level security;
alter table public.group_call_members enable row level security;

revoke all on table public.group_call_rooms, public.group_call_members from anon;
grant select, insert, update on table public.group_call_rooms to authenticated;
grant select, insert, delete on table public.group_call_members to authenticated;

create or replace function public.is_wavo_space_member(p_group_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1 from public.groups g
    where g.id = p_group_id
      and g.created_by = p_user_id
  ) or exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = p_user_id
  );
$$;

revoke all on function public.is_wavo_space_member(uuid, uuid) from public;
grant execute on function public.is_wavo_space_member(uuid, uuid) to authenticated;

create policy "space members can read group calls"
  on public.group_call_rooms for select to authenticated
  using (public.is_wavo_space_member(group_id, (select auth.uid())));

create policy "space members can start group calls"
  on public.group_call_rooms for insert to authenticated
  with check (
    (select auth.uid()) = created_by
    and public.is_wavo_space_member(group_id, (select auth.uid()))
  );

create policy "space members can end group calls"
  on public.group_call_rooms for update to authenticated
  using (public.is_wavo_space_member(group_id, (select auth.uid())))
  with check (public.is_wavo_space_member(group_id, (select auth.uid())));

create policy "space members can read call members"
  on public.group_call_members for select to authenticated
  using (
    exists (
      select 1 from public.group_call_rooms r
      where r.id = room_id
        and public.is_wavo_space_member(r.group_id, (select auth.uid()))
    )
  );

create policy "space members can join group calls"
  on public.group_call_members for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.group_call_rooms r
      where r.id = room_id
        and r.status = 'active'
        and r.expires_at > now()
        and public.is_wavo_space_member(r.group_id, (select auth.uid()))
    )
  );

create policy "people can leave group calls"
  on public.group_call_members for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Private Realtime Broadcast signalling. Only members who joined the active
-- room can send or receive offers, answers and ICE candidates.
drop policy if exists "group call members can send realtime signals" on realtime.messages;
create policy "group call members can send realtime signals"
  on realtime.messages for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) like 'wavo-group-call:%'
    and exists (
      select 1
      from public.group_call_members m
      join public.group_call_rooms r on r.id = m.room_id
      where m.room_id::text = split_part((select realtime.topic()), ':', 2)
        and m.user_id = (select auth.uid())
        and r.status = 'active'
        and r.expires_at > now()
    )
  );

drop policy if exists "group call members can receive realtime signals" on realtime.messages;
create policy "group call members can receive realtime signals"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) like 'wavo-group-call:%'
    and exists (
      select 1
      from public.group_call_members m
      join public.group_call_rooms r on r.id = m.room_id
      where m.room_id::text = split_part((select realtime.topic()), ':', 2)
        and m.user_id = (select auth.uid())
        and r.status = 'active'
        and r.expires_at > now()
    )
  );
