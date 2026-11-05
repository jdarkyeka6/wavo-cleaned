-- Wavo sensitive profile column cutover, REVIEW ONLY. NOT FOR LIVE EXECUTION.
-- DO NOT put in supabase/migrations until App Store clients using select('*')
-- have been updated or blocked from querying the legacy profiles table.
--
-- WHY: table-level SELECT grants override column-level restrictions.
-- Removing SELECT on profiles breaks old clients that request *.
-- New clients use wavo_get_my_profile_v1, wavo_get_admin_profiles_v1,
-- and wavo_public_profiles_v1, with explicit safe column projections.
--
-- Prerequisites: verified web+iOS release; audit all caller queries;
-- verify PostgREST permissions with authenticated/non-admin/admin roles;
-- verify normal UPDATE flows, premium, login, friends and admin functions.
--
-- CRITICAL: ALTER this allowlist only after auditing all client .select(...)
-- and all view / function dependencies. Old iOS builds remain an obstacle.

begin;

revoke select on table public.profiles from public, anon, authenticated;

grant select (
  id, username, is_admin, banned, created_at, avatar_url,
  last_active, status, equipped_theme, equipped_badge,
  is_premium, premium_until, equipped_name_style, tier,
  bio, status_expires_at, show_online, read_receipts,
  allow_friend_requests, allow_messages_from,
  is_fictional_character, username_changed_at,
  entitlement_source, is_internal, is_employee
) on table public.profiles to authenticated;

-- Protected by new RPCs; the following are no longer readable directly:
-- email, birthday, stripe_customer_id, first_name, last_name, age,
-- banned_until, location_default, support_unlimited.

-- Post-deployment tests required before committing transaction:
-- signed-in user can read public directory but not stripe_customer_id.
-- the owner RPC returns only their own full record.
-- signed-in non-admin cannot invoke the admin RPC.
-- authenticated users can still update own bio/status; admins can moderate.
commit;
