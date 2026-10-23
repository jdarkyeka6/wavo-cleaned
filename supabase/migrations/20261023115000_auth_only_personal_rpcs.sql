-- 2026-10-23: restrict personally scoped RPCs to signed-in roles.
-- The seven function bodies were audited against live definitions:
-- each reads auth.uid() or checks the caller's membership; unauthenticated
-- invocations cannot perform the intended operation.
-- Keep functions, argument lists, table RLS, and service-role use unchanged.
-- This does NOT alter existing APNs tokens or device subscriptions.
REVOKE EXECUTE ON FUNCTION public.claim_ios_voip_push_subscription(text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.release_ios_push_subscription(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.release_ios_voip_push_subscription(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_my_account() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_message_pins(text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_streak_state() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.touch_activity() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.claim_ios_voip_push_subscription(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_ios_push_subscription(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_ios_voip_push_subscription(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_message_pins(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_streak_state() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.touch_activity() TO authenticated, service_role;
