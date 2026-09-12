-- Give every Wavo account a private DM with itself so Inbox can double as notes.
insert into public.friend_requests (sender_id, receiver_id, status)
select id, id, 'accepted'
from public.profiles
on conflict (sender_id, receiver_id) do update set status = 'accepted';

create or replace function public.ensure_self_notes_friendship()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.friend_requests (sender_id, receiver_id, status)
  values (new.id, new.id, 'accepted')
  on conflict (sender_id, receiver_id) do update set status = 'accepted';
  return new;
end;
$$;

drop trigger if exists profiles_ensure_self_notes_friendship on public.profiles;
create trigger profiles_ensure_self_notes_friendship
after insert on public.profiles
for each row execute function public.ensure_self_notes_friendship();