-- REVIEW ONLY: not applied to production.
-- Mechanically generated from exact live pg_policies expressions on 2026-10-25.
-- This wraps auth.uid() in an initplan-friendly SELECT without changing predicates.

alter policy "create own blocks" on public.blocks
  with check (((select auth.uid()) = blocker_id));

alter policy "remove own blocks" on public.blocks
  using (((select auth.uid()) = blocker_id));

alter policy "see own blocks" on public.blocks
  using (((select auth.uid()) = blocker_id));

alter policy "chat_pins_delete_own" on public.chat_pins
  using ((user_id = (select auth.uid())));

alter policy "chat_pins_insert_own" on public.chat_pins
  with check ((user_id = (select auth.uid())));

alter policy "chat_pins_select_own" on public.chat_pins
  using ((user_id = (select auth.uid())));

alter policy "scheduled_delete_own" on public.scheduled_messages
  using (((sender_id = (select auth.uid())) AND (delivered_at IS NULL)));

alter policy "scheduled_insert_own" on public.scheduled_messages
  with check ((sender_id = (select auth.uid())));

alter policy "scheduled_select_own" on public.scheduled_messages
  using ((sender_id = (select auth.uid())));

alter policy "own push subs" on public.push_subscriptions
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));
