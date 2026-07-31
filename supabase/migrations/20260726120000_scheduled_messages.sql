-- Send later: a message you write now that lands at a chosen time.
--
-- Rows live here until they're due, then get copied into `messages` or
-- `group_messages` by deliver_due_messages(). Delivery is pull-based: any
-- signed-in client flushes the whole due queue, not just its own, so a
-- scheduled message doesn't wait for its author to come back online. The
-- trade-off is that "due" means "at or after", not "to the second" — see
-- the note at the bottom about pg_cron if that isn't good enough.

create table if not exists public.scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('dm', 'group')),
  -- chat_id for a dm, group id for a group
  conversation_id text not null,
  -- only set for dms; group rows leave this null
  recipient_id uuid references public.profiles(id) on delete cascade,
  content text not null check (length(btrim(content)) between 1 and 4000),
  send_at timestamptz not null,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  constraint scheduled_dm_needs_recipient
    check (kind <> 'dm' or recipient_id is not null)
);

create index if not exists scheduled_messages_due_idx
  on public.scheduled_messages (send_at)
  where delivered_at is null;

create index if not exists scheduled_messages_mine_idx
  on public.scheduled_messages (sender_id, conversation_id)
  where delivered_at is null;

alter table public.scheduled_messages enable row level security;

-- You can see and cancel your own pending messages. Everything that *writes*
-- into a conversation goes through the RPCs below, which re-check access.
drop policy if exists scheduled_select_own on public.scheduled_messages;
create policy scheduled_select_own on public.scheduled_messages
  for select to authenticated using (sender_id = auth.uid());
drop policy if exists scheduled_delete_own on public.scheduled_messages;
create policy scheduled_delete_own on public.scheduled_messages
  for delete to authenticated
  using (sender_id = auth.uid() and delivered_at is null);

-- ---------------------------------------------------------------------------
-- Scheduling
-- ---------------------------------------------------------------------------
create or replace function public.schedule_message(
  p_kind text,
  p_conversation_id text,
  p_recipient uuid,
  p_content text,
  p_send_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  pending int;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not public.can_access_conversation(p_kind, p_conversation_id) then
    raise exception 'You do not have access to this conversation';
  end if;
  if p_send_at <= now() then
    raise exception 'Pick a time in the future';
  end if;
  if p_send_at > now() + interval '1 year' then
    raise exception 'That is more than a year away';
  end if;
  if length(btrim(coalesce(p_content, ''))) = 0 then
    raise exception 'Message is empty';
  end if;

  -- A cheap ceiling so a scripted client can't fill the table.
  select count(*) into pending
    from public.scheduled_messages
   where sender_id = auth.uid() and delivered_at is null;
  if pending >= 50 then
    raise exception 'You already have 50 messages waiting to send';
  end if;

  insert into public.scheduled_messages
    (sender_id, kind, conversation_id, recipient_id, content, send_at)
  values
    (auth.uid(), p_kind, p_conversation_id,
     case when p_kind = 'dm' then p_recipient else null end,
     btrim(p_content), p_send_at)
  returning id into new_id;

  return new_id;
end $$;

grant execute on function
  public.schedule_message(text, text, uuid, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Delivery
-- ---------------------------------------------------------------------------
-- Deliberately not scoped to the caller: whoever opens the app flushes the
-- queue for everyone, so a message scheduled overnight goes out when the app
-- is next used by anybody rather than waiting for its author.
create or replace function public.deliver_due_messages()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  row_rec record;
  sent int := 0;
begin
  -- No auth.uid() gate on purpose: access is controlled by the grant below,
  -- and gating on a signed-in user would stop the documented pg_cron path
  -- (which runs with no JWT) from ever delivering anything.
  for row_rec in
    select * from public.scheduled_messages
     where delivered_at is null and send_at <= now()
     order by send_at
     limit 200
     for update skip locked
  loop
    begin
      if row_rec.kind = 'dm' then
        insert into public.messages
          (chat_id, sender_id, receiver_id, content, type, is_read)
        values
          (row_rec.conversation_id, row_rec.sender_id, row_rec.recipient_id,
           row_rec.content, 'text', false);
      else
        insert into public.group_messages (group_id, sender_id, content, type)
        values
          (row_rec.conversation_id::uuid, row_rec.sender_id::text,
           row_rec.content, 'text');
      end if;

      update public.scheduled_messages
         set delivered_at = now()
       where id = row_rec.id;
      sent := sent + 1;
    exception when others then
      -- One bad row (a deleted group, a blocked recipient) must not stop the
      -- rest of the queue. Mark it delivered so it isn't retried forever.
      update public.scheduled_messages
         set delivered_at = now()
       where id = row_rec.id;
    end;
  end loop;

  return sent;
end $$;

grant execute on function public.deliver_due_messages() to authenticated;

-- ---------------------------------------------------------------------------
-- Cancelling
-- ---------------------------------------------------------------------------
create or replace function public.cancel_scheduled_message(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  removed int;
begin
  delete from public.scheduled_messages
   where id = p_id and sender_id = auth.uid() and delivered_at is null;
  get diagnostics removed = row_count;
  return removed > 0;
end $$;

grant execute on function public.cancel_scheduled_message(uuid) to authenticated;

-- If delivery ever needs to be independent of anyone using the app, pg_cron is
-- available on this project but not installed:
--   create extension pg_cron;
--   select cron.schedule('wavo-send-later', '* * * * *',
--                        $sql$ select public.deliver_due_messages(); $sql$);
-- deliver_due_messages() is written to be safe either way.
