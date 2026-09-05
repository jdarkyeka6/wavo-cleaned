-- Send a real push notification when a video/voice call starts ringing.
-- This reuses Wavo's existing notifications -> push_dispatch_queue -> send-push
-- pipeline, so it works even when the app is backgrounded or closed.

create or replace function public.notify_on_incoming_call()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  caller_name text;
  call_label  text;
begin
  if new.status <> 'ringing' then
    return new;
  end if;

  select username
    into caller_name
    from public.profiles
   where id = new.caller_id;

  call_label := case new.mode
    when 'voice' then 'Incoming voice call'
    else 'Incoming video call'
  end;

  insert into public.notifications (
    user_id,
    sender_id,
    title,
    body,
    chat_id
  ) values (
    new.callee_id,
    new.caller_id,
    call_label,
    coalesce('@' || caller_name, 'Someone') || ' is calling you',
    'call:' || new.id::text
  );

  return new;
end;
$$;

drop trigger if exists on_incoming_call_notify on public.call_sessions;
create trigger on_incoming_call_notify
  after insert on public.call_sessions
  for each row execute function public.notify_on_incoming_call();
