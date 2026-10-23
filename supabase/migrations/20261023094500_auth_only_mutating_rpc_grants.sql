-- Explicitly restrict mutating, account-bound RPCs to authenticated sessions.
-- Each function already requires auth.uid() / current membership internally.
-- Do not change the functions' bodies or the existing RLS policies.
-- Grant authenticated and service_role explicitly because PUBLIC grants were
-- previously inherited by both and must not be the only privilege source.
-- Public-facing profile and authorisation helper RPCs are deliberately excluded.

REVOKE EXECUTE ON FUNCTION public.add_group_member_secure(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.remove_group_member_secure(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rename_group_secure(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_group_secure(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.transfer_group_ownership(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.block_user(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.unblock_user(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.schedule_message(text, text, uuid, text, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_scheduled_message(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.toggle_message_pin(text, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.add_group_member_secure(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_group_member_secure(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rename_group_secure(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_group_secure(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transfer_group_ownership(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.block_user(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unblock_user(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.schedule_message(text, text, uuid, text, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_scheduled_message(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.toggle_message_pin(text, text, text) TO authenticated, service_role;
