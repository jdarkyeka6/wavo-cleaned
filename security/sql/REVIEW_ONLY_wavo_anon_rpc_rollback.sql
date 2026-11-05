-- REVIEW ONLY. Restore effective permissions observed on 2026-10-31.
-- Use only for rolling back a staged application of the matching script.
BEGIN;

GRANT EXECUTE ON FUNCTION
  public.are_friends(uuid, uuid),
  public.blocked_between(uuid, uuid),
  public.can_touch_plan(uuid, text),
  public.effective_tier(uuid),
  public.is_admin(uuid),
  public.is_banned(uuid),
  public.is_group_admin(uuid),
  public.is_group_creator(uuid, uuid),
  public.is_group_member(uuid, uuid)
TO PUBLIC, anon, authenticated, service_role;

COMMIT;
