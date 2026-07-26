-- Wavo social upgrades: group roles, pinned chats, message pinning, and public profile stats.
-- All destructive group operations are enforced server-side, not just hidden in the UI.

-- ---------------------------------------------------------------------------
-- GROUP ROLES
-- ---------------------------------------------------------------------------
alter table public.group_members
  add column if not exists role text not null default 'member';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'group_members_role_check'
  ) then
    alter table public.group_members
      add constraint group_members_role_check
      check (role in ('owner', 'admin', 'member'));
  end if;
end $$;

-- The creator owns existing and future groups.
update public.group_members gm
set role = 'owner'
from public.groups g
where gm.group_id = g.id
  and gm.user_id = g.created_by
  and gm.role <> 'owner';

create or replace function public.my_group_role(p_group uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select gm.role
  from public.group_members gm
  where gm.group_id = p_group and gm.user_id = auth.uid()
  limit 1
$$;

grant execute on function public.my_group_role(uuid) to authenticated;

create or replace function public.set_group_role(p_group uuid, p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  target_role text;
begin
  if p_role not in ('admin', 'member') then
    raise exception 'Role must be admin or member';
  end if;

  select role into caller_role from public.group_members
   where group_id = p_group and user_id = auth.uid();
  if caller_role <> 'owner' then
    raise exception 'Only the group owner can change roles';
  end if;

  select role into target_role from public.group_members
   where group_id = p_group and user_id = p_user;
  if target_role is null then raise exception 'User is not in this group'; end if;
  if target_role = 'owner' then raise exception 'Transfer ownership instead'; end if;

  update public.group_members set role = p_role
   where group_id = p_group and user_id = p_user;
end $$;

grant execute on function public.set_group_role(uuid, uuid, text) to authenticated;

create or replace function public.rename_group_secure(p_group uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  clean text := btrim(p_name);
begin
  if length(clean) < 1 or length(clean) > 80 then
    raise exception 'Group name must be 1 to 80 characters';
  end if;
  select role into caller_role from public.group_members
   where group_id = p_group and user_id = auth.uid();
  if caller_role not in ('owner', 'admin') then
    raise exception 'Only owners and admins can rename this group';
  end if;
  update public.groups set name = clean where id = p_group;
end $$;

grant execute on function public.rename_group_secure(uuid, text) to authenticated;

create or replace function public.remove_group_member_secure(p_group uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  target_role text;
begin
  select role into caller_role from public.group_members
   where group_id = p_group and user_id = auth.uid();
  select role into target_role from public.group_members
   where group_id = p_group and user_id = p_user;

  if caller_role not in ('owner', 'admin') then
    raise exception 'Only owners and admins can remove members';
  end if;
  if target_role = 'owner' then
    raise exception 'The owner cannot be removed';
  end if;
  if caller_role = 'admin' and target_role = 'admin' then
    raise exception 'Admins cannot remove other admins';
  end if;

  delete from public.group_members where group_id = p_group and user_id = p_user;
end $$;

grant execute on function public.remove_group_member_secure(uuid, uuid) to authenticated;

create or replace function public.transfer_group_ownership(p_group uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
begin
  select role into caller_role from public.group_members
   where group_id = p_group and user_id = auth.uid();
  if caller_role <> 'owner' then raise exception 'Only the owner can transfer ownership'; end if;
  if not exists (select 1 from public.group_members where group_id = p_group and user_id = p_user) then
    raise exception 'New owner must already be a group member';
  end if;

  update public.group_members set role = 'member'
   where group_id = p_group and user_id = auth.uid();
  update public.group_members set role = 'owner'
   where group_id = p_group and user_id = p_user;
  update public.groups set created_by = p_user where id = p_group;
end $$;

grant execute on function public.transfer_group_ownership(uuid, uuid) to authenticated;

create or replace function public.delete_group_secure(p_group uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.group_members
    where group_id = p_group and user_id = auth.uid() and role = 'owner'
  ) then
    raise exception 'Only the owner can delete this group';
  end if;
  delete from public.groups where id = p_group;
end $$;

grant execute on function public.delete_group_secure(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- PINNED CHATS (private to each user)
-- ---------------------------------------------------------------------------
create table if not exists public.chat_pins (
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('dm', 'group')),
  target_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, kind, target_id)
);

alter table public.chat_pins enable row level security;

drop policy if exists chat_pins_select_own on public.chat_pins;
create policy chat_pins_select_own on public.chat_pins
  for select to authenticated using (user_id = auth.uid());
drop policy if exists chat_pins_insert_own on public.chat_pins;
create policy chat_pins_insert_own on public.chat_pins
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists chat_pins_delete_own on public.chat_pins;
create policy chat_pins_delete_own on public.chat_pins
  for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- MESSAGE PINS (shared within a conversation)
-- Generic text IDs let this work whether existing message ids are UUIDs or ints.
-- ---------------------------------------------------------------------------
create table if not exists public.message_pins (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('dm', 'group')),
  conversation_id text not null,
  message_id text not null,
  pinned_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (kind, message_id)
);

alter table public.message_pins enable row level security;

-- Access checks are kept in security-definer helpers so the client never gets
-- authority merely because it knows a message id.
create or replace function public.can_access_conversation(p_kind text, p_conversation_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return false; end if;
  if p_kind = 'group' then
    return exists (
      select 1 from public.group_members gm
      where gm.group_id::text = p_conversation_id and gm.user_id = auth.uid()
    );
  elsif p_kind = 'dm' then
    return exists (
      select 1 from public.messages m
      where m.chat_id = p_conversation_id
        and (m.sender_id = auth.uid() or m.receiver_id = auth.uid())
    );
  end if;
  return false;
end $$;

create or replace function public.get_message_pins(p_kind text, p_conversation_id text)
returns setof public.message_pins
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_access_conversation(p_kind, p_conversation_id) then
    return;
  end if;
  return query
    select * from public.message_pins
    where kind = p_kind and conversation_id = p_conversation_id
    order by created_at desc;
end $$;

grant execute on function public.get_message_pins(text, text) to authenticated;

create or replace function public.toggle_message_pin(
  p_kind text,
  p_conversation_id text,
  p_message_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  exists_pin boolean;
begin
  if not public.can_access_conversation(p_kind, p_conversation_id) then
    raise exception 'You do not have access to this conversation';
  end if;

  if p_kind = 'group' then
    select gm.role into caller_role
    from public.group_members gm
    where gm.group_id::text = p_conversation_id and gm.user_id = auth.uid();
    if caller_role not in ('owner', 'admin') then
      raise exception 'Only group owners and admins can pin messages';
    end if;
    if not exists (
      select 1 from public.group_messages gm
      where gm.id::text = p_message_id and gm.group_id::text = p_conversation_id
    ) then raise exception 'Message not found'; end if;
  elsif p_kind = 'dm' then
    if not exists (
      select 1 from public.messages m
      where m.id::text = p_message_id and m.chat_id = p_conversation_id
        and (m.sender_id = auth.uid() or m.receiver_id = auth.uid())
    ) then raise exception 'Message not found'; end if;
  else
    raise exception 'Invalid conversation kind';
  end if;

  select exists(
    select 1 from public.message_pins
    where kind = p_kind and message_id = p_message_id
  ) into exists_pin;

  if exists_pin then
    delete from public.message_pins where kind = p_kind and message_id = p_message_id;
    return false;
  end if;

  insert into public.message_pins(kind, conversation_id, message_id, pinned_by)
  values (p_kind, p_conversation_id, p_message_id, auth.uid());
  return true;
end $$;

grant execute on function public.toggle_message_pin(text, text, text) to authenticated;

-- Direct table reads/writes stay closed; clients use the vetted RPCs above.
drop policy if exists message_pins_no_direct on public.message_pins;
create policy message_pins_no_direct on public.message_pins
  for select to authenticated using (false);

-- ---------------------------------------------------------------------------
-- PUBLIC PROFILE CARD DATA
-- ---------------------------------------------------------------------------
create or replace function public.get_profile_card(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id,
    'username', p.username,
    'avatar_url', p.avatar_url,
    'status', p.status,
    'created_at', p.created_at,
    'equipped_badge', p.equipped_badge,
    'equipped_name_style', p.equipped_name_style,
    'current_streak', coalesce(s.current_streak, 0),
    'longest_streak', coalesce(s.longest_streak, 0),
    'days_active', coalesce(s.days_active, 0),
    'messages_sent', coalesce(s.messages_sent, 0),
    'mutual_friends', (
      select count(*)
      from public.profiles x
      where x.id <> auth.uid() and x.id <> p_user
        and exists (
          select 1 from public.friend_requests a
          where a.status = 'accepted'
            and ((a.sender_id = auth.uid() and a.receiver_id = x.id)
              or (a.receiver_id = auth.uid() and a.sender_id = x.id))
        )
        and exists (
          select 1 from public.friend_requests b
          where b.status = 'accepted'
            and ((b.sender_id = p_user and b.receiver_id = x.id)
              or (b.receiver_id = p_user and b.sender_id = x.id))
        )
    )
  )
  from public.profiles p
  left join public.user_stats s on s.user_id = p.id
  where p.id = p_user
$$;

grant execute on function public.get_profile_card(uuid) to authenticated;
