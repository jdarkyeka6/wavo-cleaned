-- Voice notes.
--
-- The message itself needs no new type column — `messages.type` has no check
-- constraint, and chat-files is public with no MIME restriction, so an audio
-- blob rides the existing upload path. Only two things are actually missing.

-- 1. Duration.
--
-- A voice note bubble has to show its length before you press play, and the
-- browser cannot tell us: MediaRecorder's webm output carries no duration in
-- its metadata, so <audio>.duration reads Infinity until the whole file has
-- been played through once. That is a well-known quirk, not something to work
-- around with a seek hack. We already know the length at record time, so we
-- record it.
alter table public.messages
  add column if not exists duration_ms integer;
alter table public.group_messages
  add column if not exists duration_ms integer;

-- A negative or absurd duration is a bug in whatever wrote it, and a bubble
-- claiming "-3s" is worse than one claiming nothing. Two hours is far past the
-- client's own two-minute cap.
alter table public.messages drop constraint if exists messages_duration_sane;
alter table public.messages add constraint messages_duration_sane
  check (duration_ms is null or (duration_ms >= 0 and duration_ms <= 7200000));

alter table public.group_messages drop constraint if exists group_messages_duration_sane;
alter table public.group_messages add constraint group_messages_duration_sane
  check (duration_ms is null or (duration_ms >= 0 and duration_ms <= 7200000));

-- 2. Notification wording.
--
-- Both notify triggers fall through to left(content, 120) for anything that
-- isn't an image — and for a voice note (or a file) `content` is the storage
-- URL. Without this, the push you get for a voice note reads
-- "https://vwgfohrtgharvqcndruw.supabase.co/storage/v1/object/public/...".
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
      else left(coalesce(new.content, ''), 120)
    end,
    new.group_id::text
  from public.group_members gm
  where gm.group_id = new.group_id
    and gm.user_id is distinct from sender;

  return new;
end;
$$;
