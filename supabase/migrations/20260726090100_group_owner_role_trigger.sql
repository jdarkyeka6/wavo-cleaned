-- Ensure the creator is always the owner, including groups created after the
-- role column migration has already run.
create or replace function public.assign_group_creator_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- created_by is text, user_id is uuid: compare as text (see the backfill in
  -- 20260726090000_social_upgrades.sql for the same mismatch).
  if exists (
    select 1 from public.groups g
    where g.id = new.group_id and g.created_by = new.user_id::text
  ) then
    new.role := 'owner';
  elsif new.role is null then
    new.role := 'member';
  end if;
  return new;
end $$;

drop trigger if exists trg_assign_group_creator_role on public.group_members;
create trigger trg_assign_group_creator_role
before insert or update of user_id, group_id on public.group_members
for each row execute function public.assign_group_creator_role();
