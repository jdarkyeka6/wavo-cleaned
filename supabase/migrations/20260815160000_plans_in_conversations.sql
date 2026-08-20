-- Plans become part of the conversation.
--
-- Until now a plan belonged to a group and lived in a collapsible panel above
-- the messages, which meant the thing people actually open the app to sort out
-- — who is coming, where, when — sat outside the place they were talking about
-- it. This makes a plan a message: it appears in the thread where it was made,
-- and everyone answers it in line.
--
-- Two changes are needed for that. A plan has to be able to belong to a DM as
-- well as a group, because half of "are you coming on Friday" happens one to
-- one. And the notify triggers have to know what a plan is, or the push for one
-- reads as a bare uuid.

-- ---------------------------------------------------------------------------
-- Structured places
-- ---------------------------------------------------------------------------

-- These columns were written in #10 and applied to the project, but the file
-- never landed on main, so a fresh database would not have them. Repeated here
-- idempotently: the schema should be reproducible from this directory alone,
-- not from what happens to have been run by hand.
alter table public.plans
  add column if not exists place_name    text,
  add column if not exists place_address text,
  add column if not exists place_lat     double precision,
  add column if not exists place_lng     double precision;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'plans_place_lat_range') then
    alter table public.plans add constraint plans_place_lat_range
      check (place_lat is null or place_lat between -90 and 90);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'plans_place_lng_range') then
    alter table public.plans add constraint plans_place_lng_range
      check (place_lng is null or place_lng between -180 and 180);
  end if;
  -- A latitude on its own is not a location. Either both or neither.
  if not exists (select 1 from pg_constraint where conname = 'plans_place_coords_pair') then
    alter table public.plans add constraint plans_place_coords_pair
      check ((place_lat is null) = (place_lng is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'plans_place_text_len') then
    alter table public.plans add constraint plans_place_text_len
      check ((place_name is null or length(place_name) <= 120)
         and (place_address is null or length(place_address) <= 300));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- A plan can belong to a DM
-- ---------------------------------------------------------------------------

alter table public.plans alter column group_id drop not null;
alter table public.plans add column if not exists chat_id text;

-- Exactly one home. A plan in both places, or neither, is not addressable by
-- the policies below and would be invisible to everyone.
alter table public.plans drop constraint if exists plans_one_conversation;
alter table public.plans add constraint plans_one_conversation
  check ((group_id is null) <> (chat_id is null));

create index if not exists plans_chat_id_idx on public.plans (chat_id) where chat_id is not null;

-- Who may touch a DM plan.
--
-- can_access_conversation('dm', ...) answers this by looking for an existing
-- message between the two people, which is circular here — the first plan in a
-- conversation may be the first message in it. A DM's chat_id is the two user
-- ids sorted and joined with '_' (see dmChatId in src/App.jsx), and a uuid
-- contains no underscore, so the halves can be compared directly.
create or replace function public.is_dm_participant(cid text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select auth.uid() is not null
     and cid is not null
     and (split_part(cid, '_', 1) = auth.uid()::text
       or split_part(cid, '_', 2) = auth.uid()::text);
$$;

-- Readable, writable and deletable by whoever is in the conversation the plan
-- belongs to — the group's members, or the DM's two participants.
create or replace function public.can_touch_plan(p_group uuid, p_chat text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
           when p_group is not null then public.is_group_member(p_group, auth.uid())
           when p_chat  is not null then public.is_dm_participant(p_chat)
           else false
         end;
$$;

drop policy if exists "plans readable by members" on public.plans;
create policy "plans readable in conversation" on public.plans
  for select using (public.can_touch_plan(group_id, chat_id));

drop policy if exists "members create plans" on public.plans;
create policy "participants create plans" on public.plans
  for insert with check (
    created_by = auth.uid()
    and public.can_touch_plan(group_id, chat_id)
    and not public.is_banned(auth.uid())
  );

-- Editing and cancelling stay with the person who made it, or a group admin.
-- A DM has no admin, so there it is the creator only.
drop policy if exists "owner or admin edits plan" on public.plans;
create policy "owner or admin edits plan" on public.plans
  for update
  using (created_by = auth.uid() or (group_id is not null and public.is_group_admin(group_id)))
  with check (created_by = auth.uid() or (group_id is not null and public.is_group_admin(group_id)));

drop policy if exists "owner or admin deletes plan" on public.plans;
create policy "owner or admin deletes plan" on public.plans
  for delete
  using (created_by = auth.uid() or (group_id is not null and public.is_group_admin(group_id)));

-- ---------------------------------------------------------------------------
-- RSVPs follow the plan
-- ---------------------------------------------------------------------------

drop policy if exists "rsvps readable by members" on public.plan_rsvps;
create policy "rsvps readable in conversation" on public.plan_rsvps
  for select using (
    exists (select 1 from public.plans p
             where p.id = plan_rsvps.plan_id
               and public.can_touch_plan(p.group_id, p.chat_id))
  );

drop policy if exists "rsvp for self only" on public.plan_rsvps;
create policy "rsvp for self only" on public.plan_rsvps
  for insert with check (
    user_id = auth.uid()
    and not public.is_banned(auth.uid())
    and exists (select 1 from public.plans p
                 where p.id = plan_rsvps.plan_id
                   and public.can_touch_plan(p.group_id, p.chat_id))
  );

-- ---------------------------------------------------------------------------
-- A plan reads as a plan in notifications
-- ---------------------------------------------------------------------------

-- Both triggers fall through to left(content, 120) for anything they don't
-- recognise, and a plan message's content is the plan's uuid — so without this
-- the push would read as a row of hex.
--
-- Reproduced from the live definitions with one arm added to each case. The
-- rest is deliberately untouched: 'image' says "Sent a GIF" rather than photo
-- because that is what the picker inserts, and the file arm carries the
-- filename. Rewriting these from memory would have quietly dropped both.
create or replace function public.notify_on_message()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare sender_name text;
begin
  select username into sender_name from public.profiles where id = new.sender_id;
  insert into public.notifications (user_id, sender_id, title, body, chat_id)
  values (
    new.receiver_id,
    new.sender_id,
    sender_name,
    case new.type
      when 'image' then 'Sent a GIF'
      when 'audio' then 'Sent a voice note'
      when 'file'  then coalesce('Sent ' || new.file_name, 'Sent a file')
      when 'plan'  then 'Made a plan'
      else left(coalesce(new.content, ''), 120)
    end,
    new.chat_id
  );
  return new;
end;
$$;

create or replace function public.notify_on_group_message()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  sender      uuid;
  sender_name text;
  group_name  text;
begin
  begin
    sender := coalesce(new.sender_id, new.user_id)::uuid;
  exception when others then
    return new;
  end;

  if sender is null or new.group_id is null then
    return new;
  end if;

  select username into sender_name from public.profiles where id = sender;
  select name     into group_name  from public.groups   where id = new.group_id;

  insert into public.notifications (user_id, sender_id, title, body, chat_id)
  select
    gm.user_id,
    sender,
    coalesce(group_name, 'Group') || ' · ' || coalesce(sender_name, 'Someone'),
    case new.type
      when 'image' then 'Sent a GIF'
      when 'audio' then 'Sent a voice note'
      when 'file'  then coalesce('Sent ' || new.file_name, 'Sent a file')
      when 'plan'  then 'Made a plan'
      else left(coalesce(new.content, ''), 120)
    end,
    new.group_id::text
  from public.group_members gm
  where gm.group_id = new.group_id
    and gm.user_id is distinct from sender;

  return new;
end;
$$;
