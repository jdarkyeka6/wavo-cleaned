-- App Review hardening: make permanent account deletion complete and safe.
-- Storage files are deleted through the Storage API in the delete-account Edge Function.
-- This function only removes database rows after storage cleanup succeeds.

create or replace function public.cleanup_account_for_deletion(target_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service role required';
  end if;

  -- Legacy/non-FK rows that would otherwise survive profile deletion.
  delete from public.chat_members where user_id = target_user;
  delete from public.message_reads where user_id = target_user;
  delete from public.typing_status where user_id = target_user;
  delete from public.group_messages
    where sender_id = target_user::text or user_id = target_user::text;

  -- Preserve shared containers while removing the deleted account as creator.
  update public.chats set created_by = null where created_by = target_user;
  update public.groups set created_by = null where created_by = target_user::text;

  if to_regclass('public.announcements') is not null then
    execute 'delete from public.announcements where created_by = $1' using target_user::text;
  end if;
  if to_regclass('public.games') is not null then
    execute 'delete from public.games where created_by = $1' using target_user::text;
  end if;

  -- Most Wavo user data is FK'd to profiles with ON DELETE CASCADE.
  delete from public.profiles where id = target_user;
end;
$$;

revoke all on function public.cleanup_account_for_deletion(uuid) from public;
revoke all on function public.cleanup_account_for_deletion(uuid) from anon;
revoke all on function public.cleanup_account_for_deletion(uuid) from authenticated;
grant execute on function public.cleanup_account_for_deletion(uuid) to service_role;

-- These temporary policies are removed in the next migration in favour of a
-- service-role-only path enumerator. Keeping them here mirrors production
-- migration history exactly.
drop policy if exists "account deletion list own objects" on storage.objects;
create policy "account deletion list own objects"
on storage.objects
for select
to authenticated
using (
  owner_id = (select auth.uid())::text
  and storage.allow_only_operation('object.list')
);

drop policy if exists "account deletion delete own objects" on storage.objects;
create policy "account deletion delete own objects"
on storage.objects
for delete
to authenticated
using (owner_id = (select auth.uid())::text);

update public.support_ai_knowledge
set content = 'Account deletion is in the You tab > Account > Delete account. It permanently deletes the Wavo account and associated user data and cannot be undone.'
where topic = 'account_delete';
