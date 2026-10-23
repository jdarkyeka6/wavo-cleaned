-- Allow only actual DM/Space participants to subscribe to private
-- typing broadcasts.  Typing must not reveal conversation participation.
create or replace function public.wavo_can_use_typing_topic(p_topic text)
returns boolean
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  dm_ids text[];
  friend_a uuid;
  friend_b uuid;
  space_id uuid;
  own_id uuid := auth.uid();
begin
  if own_id is null then return false; end if;
  if p_topic like 'wavo-typing:dm:%' then
    select regexp_match(
      p_topic,
      '^wavo-typing:dm:([0-9a-fA-F-]{36})_([0-9a-fA-F-]{36})$'
    ) into dm_ids;
    if dm_ids is null then return false; end if;
    friend_a := dm_ids[1]::uuid;
    friend_b := dm_ids[2]::uuid;
    return (own_id = friend_a or own_id = friend_b)
      and public.are_friends(friend_a, friend_b)
      and not public.blocked_between(friend_a, friend_b);
  elsif p_topic like 'wavo-typing:space:%' then
    if split_part(p_topic, ':', 3) !~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or p_topic <> 'wavo-typing:space:' || split_part(p_topic, ':', 3)
    then return false; end if;
    space_id := split_part(p_topic, ':', 3)::uuid;
    return public.is_group_member(space_id, own_id)
      or public.is_group_creator(space_id, own_id)
      or public.is_admin(own_id);
  end if;
  return false;
exception when invalid_text_representation then
  return false;
end;
$$;
revoke all on function public.wavo_can_use_typing_topic(text) from public, anon;
grant execute on function public.wavo_can_use_typing_topic(text) to authenticated;

create policy "chat participants receive private typing"
on realtime.messages for select to authenticated
using (
  extension = 'broadcast'
  and public.wavo_can_use_typing_topic(realtime.topic())
);
create policy "chat participants send private typing"
on realtime.messages for insert to authenticated
with check (
  extension = 'broadcast'
  and public.wavo_can_use_typing_topic(realtime.topic())
);
