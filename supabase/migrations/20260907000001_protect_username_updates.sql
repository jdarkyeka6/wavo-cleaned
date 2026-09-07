create or replace function public.protect_username_updates()
returns trigger
language plpgsql
set search_path = public, auth
as $$
begin
  if (new.username is distinct from old.username
      or new.username_changed_at is distinct from old.username_changed_at)
     and coalesce(auth.role(), '') <> 'service_role'
     and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'username changes must use the protected username-change flow';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_username_updates on public.profiles;
create trigger protect_username_updates
before update on public.profiles
for each row execute function public.protect_username_updates();
