-- Give everyone the support account, and have it say hello.
--
-- The `support` profile already existed and had been friended by hand for some
-- users — 7 accepted, 17 still pending, and nobody had ever been messaged. A
-- pending request is invisible in the sidebar (loadFriends only selects
-- status='accepted'), so most people had a support account they couldn't see
-- and couldn't reach. This makes the link automatic on signup, repairs the
-- half-finished ones, and sends the opening message.

-- ---------------------------------------------------------------------------
-- Who is support
-- ---------------------------------------------------------------------------

-- Looked up by username rather than pinned to a uuid: the id is generated data,
-- and a migration that hardcodes it breaks on any database where support was
-- created separately (a branch, a restore, a fresh dev project).
create or replace function public.support_profile_id()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select id from public.profiles where username = 'support' limit 1;
$$;

-- ---------------------------------------------------------------------------
-- The link itself
-- ---------------------------------------------------------------------------

-- A DM's chat_id is [a,b].sort().join("_") in the client (src/App.jsx,
-- dmChatId). `collate "C"` makes Postgres sort by byte the way JavaScript sorts
-- by code unit — the database's default collation can treat the dashes in a
-- uuid as ignorable punctuation, and a chat_id built the other way round is a
-- conversation neither participant can see.
create or replace function public.support_link(target uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  sup uuid := public.support_profile_id();
  cid text;
begin
  if sup is null or target is null or sup = target then
    return;
  end if;

  -- Friendship, in whichever direction it may already exist. Anything already
  -- there is promoted to accepted rather than duplicated: (sender_id,
  -- receiver_id) is unique, and a second row in the mirror direction would show
  -- up as a second copy of the same person in the friends list.
  update public.friend_requests
     set status = 'accepted'
   where ((sender_id = sup and receiver_id = target)
       or (sender_id = target and receiver_id = sup))
     and status <> 'accepted';

  if not exists (
    select 1 from public.friend_requests
     where (sender_id = sup and receiver_id = target)
        or (sender_id = target and receiver_id = sup)
  ) then
    insert into public.friend_requests (sender_id, receiver_id, status)
    values (sup, target, 'accepted')
    on conflict (sender_id, receiver_id) do update set status = 'accepted';
  end if;

  cid := case
           when sup::text collate "C" < target::text collate "C"
             then sup::text || '_' || target::text
           else target::text || '_' || sup::text
         end;

  -- The greeting goes out once per person, ever. Guarding on "has support said
  -- anything in this chat" rather than on the text itself means a later reply
  -- from a human on the support account doesn't earn them a second welcome.
  if not exists (
    select 1 from public.messages where chat_id = cid and sender_id = sup
  ) then
    insert into public.messages (chat_id, sender_id, receiver_id, content, type, is_read)
    values (
      cid, sup, target,
      'Hi, I''m the Wavo support chat. We haven''t implemented AI yet, so replies are human-led and may take some time.',
      'text', false
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Every new account gets it
-- ---------------------------------------------------------------------------

create or replace function public.support_link_on_signup()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.support_link(new.id);
  return new;
exception when others then
  -- This trigger runs inside handle_new_user, which runs inside the auth.users
  -- insert. An error raised here would abort the signup itself — nobody loses
  -- an account because the support chat couldn't be set up.
  return new;
end;
$$;

drop trigger if exists on_profile_support_link on public.profiles;
create trigger on_profile_support_link
  after insert on public.profiles
  for each row execute function public.support_link_on_signup();

-- ---------------------------------------------------------------------------
-- Everyone who was already here
-- ---------------------------------------------------------------------------

do $$
declare
  p record;
begin
  if public.support_profile_id() is null then
    raise notice 'no support profile — skipping backfill';
    return;
  end if;
  for p in
    select id from public.profiles
     where id <> public.support_profile_id()
     order by created_at
  loop
    perform public.support_link(p.id);
  end loop;
end;
$$;
