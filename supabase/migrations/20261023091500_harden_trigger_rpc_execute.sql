-- Wavo targeted trigger privilege hardening (2026-10-23)
-- This migration leaves table RLS, data, trigger definitions, and user-facing
-- authenticated RPC functions unchanged. PostgreSQL invokes installed trigger
-- functions as triggers; they do not need public EXECUTE grants.
-- Preserve service_role's existing explicit EXECUTE grants.

REVOKE EXECUTE ON FUNCTION public.assign_group_creator_role() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bump_sent_dm() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bump_sent_group() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.dispatch_call_voip_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ensure_self_notes_friendship() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_on_group_message() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_on_incoming_call() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_plan_location() FROM PUBLIC, anon, authenticated;

-- Uses only PostgreSQL built-in btrim and PL/pgSQL record operations. Ensure
-- that object resolution is deterministic without replacing the trigger body.
ALTER FUNCTION public.sync_plan_location() SET search_path TO pg_catalog, public;
