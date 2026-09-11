-- App Store account deletion support.
-- These helpers are callable only by the service role from the authenticated
-- delete-account Edge Function. The browser never receives elevated access.

create or replace function public.account_deletion_storage_objects(target_user_id uuid)
returns table(bucket_id text, name text)
language sql
security definer
set search_path = ''
stable
as $$
  select o.bucket_id, o.name
  from storage.objects as o
  where o.owner = target_user_id;
$$;

revoke all on function public.account_deletion_storage_objects(uuid) from public;
revoke all on function public.account_deletion_storage_objects(uuid) from anon;
revoke all on function public.account_deletion_storage_objects(uuid) from authenticated;
grant execute on function public.account_deletion_storage_objects(uuid) to service_role;

create or replace function public.delete_account_data(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Legacy tables store user ids as text rather than foreign keys. Remove or
  -- detach those references before deleting the profile.
  delete from public.group_messages
  where sender_id = target_user_id::text
     or user_id = target_user_id::text;

  update public.groups
  set created_by = null
  where created_by = target_user_id::text;

  update public.announcements
  set created_by = null
  where created_by = target_user_id::text;

  update public.games
  set created_by = null
  where created_by = target_user_id::text;

  -- Nearly all current Wavo user data references profiles(id) with ON DELETE
  -- CASCADE (or SET NULL for retained safety/audit references), so this one
  -- delete removes the profile, DMs, social graph, posts, Waves, plans,
  -- reactions, notification tokens, settings, entitlements and other
  -- account-linked rows atomically.
  delete from public.profiles
  where id = target_user_id;
end;
$$;

revoke all on function public.delete_account_data(uuid) from public;
revoke all on function public.delete_account_data(uuid) from anon;
revoke all on function public.delete_account_data(uuid) from authenticated;
grant execute on function public.delete_account_data(uuid) to service_role;
