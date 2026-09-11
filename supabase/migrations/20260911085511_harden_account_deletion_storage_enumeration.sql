-- Keep Storage cleanup privileged and server-side. The Edge Function asks this
-- service-role-only helper for exact object paths, then deletes those objects
-- through the Supabase Storage API before removing database/auth records.

create or replace function public.account_storage_objects_for_deletion(target_user uuid)
returns table(bucket_id text, name text)
language sql
security definer
set search_path = ''
as $$
  select o.bucket_id, o.name
  from storage.objects o
  where coalesce(o.owner_id, '') = target_user::text
     or o.owner = target_user;
$$;

revoke all on function public.account_storage_objects_for_deletion(uuid) from public;
revoke all on function public.account_storage_objects_for_deletion(uuid) from anon;
revoke all on function public.account_storage_objects_for_deletion(uuid) from authenticated;
grant execute on function public.account_storage_objects_for_deletion(uuid) to service_role;

-- No client Storage permissions are required for account deletion.
drop policy if exists "account deletion list own objects" on storage.objects;
drop policy if exists "account deletion delete own objects" on storage.objects;
