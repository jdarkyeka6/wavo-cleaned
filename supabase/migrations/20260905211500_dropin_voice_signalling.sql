-- Private Supabase Realtime broadcast signalling for Wavo drop-in voice rooms.
-- Only current members of an open room can send or receive WebRTC signalling.

drop policy if exists "dropin members can send realtime signals" on realtime.messages;
create policy "dropin members can send realtime signals"
  on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) like 'wavo-room:%'
    and exists (
      select 1
      from public.dropin_room_members m
      join public.dropin_rooms r on r.id = m.room_id
      where m.room_id::text = split_part((select realtime.topic()), ':', 2)
        and m.user_id = (select auth.uid())
        and r.is_open
    )
  );

drop policy if exists "dropin members can receive realtime signals" on realtime.messages;
create policy "dropin members can receive realtime signals"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) like 'wavo-room:%'
    and exists (
      select 1
      from public.dropin_room_members m
      join public.dropin_rooms r on r.id = m.room_id
      where m.room_id::text = split_part((select realtime.topic()), ':', 2)
        and m.user_id = (select auth.uid())
        and r.is_open
    )
  );
