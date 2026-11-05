-- Lock down public execution rights on RPCs not needed by RLS policy expressions.
-- Signed-in client flows and backend service calls retain execution rights.
revoke execute on function public.can_access_conversation(text,text) from public, anon;
grant execute on function public.can_access_conversation(text,text) to authenticated, service_role;

revoke execute on function public.get_profile_card(uuid) from public, anon;
grant execute on function public.get_profile_card(uuid) to authenticated, service_role;

revoke execute on function public.is_dm_participant(text) from public, anon;
grant execute on function public.is_dm_participant(text) to authenticated, service_role;
