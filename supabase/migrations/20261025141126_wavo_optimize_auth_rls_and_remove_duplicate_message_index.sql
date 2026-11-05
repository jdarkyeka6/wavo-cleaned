-- Optimize per-row auth.uid() calls using initplan evaluation while preserving existing authorization rules.
-- Policies selected by exact table/name; the USING and WITH CHECK expressions were read from production.
-- No grants or role permissions are changed.

alter policy "create own profile" on public.profiles
  with check (((select auth.uid()) = id));

alter policy "profiles readable" on public.profiles
  using (((select auth.uid()) IS NOT NULL));

alter policy "read own messages" on public.messages
  using ((((select auth.uid()) = sender_id) OR ((select auth.uid()) = receiver_id) OR is_admin((select auth.uid()))));

alter policy "delete messages" on public.messages
  using ((((select auth.uid()) = sender_id) OR is_admin((select auth.uid()))));

alter policy "update read state" on public.messages
  using ((((select auth.uid()) = receiver_id) OR ((select auth.uid()) = sender_id)));

alter policy "read own notifs" on public.notifications
  using (((select auth.uid()) = user_id));

alter policy "update own notifs" on public.notifications
  using (((select auth.uid()) = user_id));

alter policy "delete own notifs" on public.notifications
  using ((((select auth.uid()) = user_id) OR is_admin((select auth.uid()))));

alter policy "see own requests" on public.friend_requests
  using ((((select auth.uid()) = sender_id) OR ((select auth.uid()) = receiver_id) OR is_admin((select auth.uid()))));

alter policy "respond to request" on public.friend_requests
  using (((select auth.uid()) = receiver_id));

alter policy "delete request" on public.friend_requests
  using ((((select auth.uid()) = sender_id) OR ((select auth.uid()) = receiver_id)));

alter policy "members read group messages" on public.group_messages
  using ((is_group_member(group_id, (select auth.uid())) OR is_admin((select auth.uid()))));

alter policy "members send group messages" on public.group_messages
  with check (((sender_id = ((select auth.uid()))::text) AND is_group_member(group_id, (select auth.uid())) AND (NOT is_banned((select auth.uid())))));

-- Identical btree (chat_id, created_at) duplicates. Keep the frequently-used idx_messages_chat_created.
-- This index was unused at audit; dropping it reduces write/index overhead.
drop index if exists public.messages_chat_id_created_at_idx;
