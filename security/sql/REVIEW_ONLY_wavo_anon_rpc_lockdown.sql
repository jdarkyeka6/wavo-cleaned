-- REVIEW ONLY: NOT a migration. Do NOT apply to production or merge into
-- supabase/migrations without a tested staged rollout and explicit approval.
--
-- Goal: stop unauthenticated PostgREST callers from invoking Wavo's nine
-- SECURITY DEFINER helper RPCs. Their existing authenticated/service callers
-- and downstream RLS policies must continue working.
--
-- Based on live pg_proc ACL read-back on 2026-10-31. All nine have PUBLIC,
-- anon, authenticated, and service_role EXECUTE; original ACLs are preserved
-- in REVIEW_ONLY_wavo_anon_rpc_rollback.sql.
--
-- Preflight: fail if any signature is missing or has lost SECURITY DEFINER.
BEGIN;

DO $check$
DECLARE selected record;
BEGIN
  FOR selected IN
    SELECT unnest(ARRAY[
      'public.are_friends(uuid, uuid)'::regprocedure,
      'public.blocked_between(uuid, uuid)'::regprocedure,
      'public.can_touch_plan(uuid, text)'::regprocedure,
      'public.effective_tier(uuid)'::regprocedure,
      'public.is_admin(uuid)'::regprocedure,
      'public.is_banned(uuid)'::regprocedure,
      'public.is_group_admin(uuid)'::regprocedure,
      'public.is_group_creator(uuid, uuid)'::regprocedure,
      'public.is_group_member(uuid, uuid)'::regprocedure
    ]) AS oid
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = selected.oid AND p.prosecdef) THEN
      RAISE EXCEPTION 'Function % is missing or changed security model', selected.oid;
    END IF;
  END LOOP;
END;
$check$;

REVOKE EXECUTE ON FUNCTION
  public.are_friends(uuid, uuid),
  public.blocked_between(uuid, uuid),
  public.can_touch_plan(uuid, text),
  public.effective_tier(uuid),
  public.is_admin(uuid),
  public.is_banned(uuid),
  public.is_group_admin(uuid),
  public.is_group_creator(uuid, uuid),
  public.is_group_member(uuid, uuid)
FROM PUBLIC, anon;

-- Explicitly preserve app and trusted backend execution after PUBLIC removal.
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
TO authenticated, service_role;

-- These assertions are for STAGING only; an error rolls back everything.
DO $verify$
DECLARE fn oid;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.are_friends(uuid, uuid)'::regprocedure,
    'public.blocked_between(uuid, uuid)'::regprocedure,
    'public.can_touch_plan(uuid, text)'::regprocedure,
    'public.effective_tier(uuid)'::regprocedure,
    'public.is_admin(uuid)'::regprocedure,
    'public.is_banned(uuid)'::regprocedure,
    'public.is_group_admin(uuid)'::regprocedure,
    'public.is_group_creator(uuid, uuid)'::regprocedure,
    'public.is_group_member(uuid, uuid)'::regprocedure
  ] LOOP
    IF has_function_privilege('anon', fn, 'EXECUTE')
      OR NOT has_function_privilege('authenticated', fn, 'EXECUTE')
      OR NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'RPC access check failed for %', fn::regprocedure;
    END IF;
  END LOOP;
END;
$verify$;

COMMIT;
