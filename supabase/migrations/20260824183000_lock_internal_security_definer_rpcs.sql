-- App Store release hardening.
-- These functions are trigger/scheduler/internal helpers, not client RPCs.
-- Keep them executable by database/service owners while removing direct API
-- execution for anonymous and normal authenticated sessions.

revoke execute on function public.assign_group_creator_role() from anon, authenticated;
revoke execute on function public.bump_sent_dm() from anon, authenticated;
revoke execute on function public.bump_sent_group() from anon, authenticated;
revoke execute on function public.notify_on_group_message() from anon, authenticated;
revoke execute on function public.support_link_on_signup() from anon, authenticated;
revoke execute on function public.support_link(uuid) from anon, authenticated;
revoke execute on function public.support_profile_id() from anon, authenticated;
revoke execute on function public.deliver_due_messages() from anon, authenticated;
revoke execute on function public.strip_lapsed_premium() from anon, authenticated;
