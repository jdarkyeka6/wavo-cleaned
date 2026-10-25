-- Stage 1: backward-compatible Wavo profile privacy API.
-- Does not revoke legacy profile SELECT grants; old iOS clients continue working.
-- Stage 2 column grants must NOT be applied until web and iOS clients migrate.

create or replace function public.wavo_get_my_profile_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $func$
declare
  caller uuid := (select auth.uid());
  result jsonb;
begin
  if caller is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  select to_jsonb(p) into result
  from public.profiles as p
  where p.id = caller;
  return result;
end;
$func$;
revoke all on function public.wavo_get_my_profile_v1() from public, anon, authenticated;
grant execute on function public.wavo_get_my_profile_v1() to authenticated, service_role;

create or replace function public.wavo_get_admin_profiles_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $func$
declare
  caller uuid := (select auth.uid());
  result jsonb;
begin
  if caller is null or not exists (
    select 1 from public.profiles where id = caller and is_admin is true
  ) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc), '[]'::jsonb)
  into result
  from public.profiles as p;
  return result;
end;
$func$;
revoke all on function public.wavo_get_admin_profiles_v1() from public, anon, authenticated;
grant execute on function public.wavo_get_admin_profiles_v1() to authenticated, service_role;

-- A security-invoker view exposes safe directory fields only.
-- Keep the invoker flag: a default Postgres view could bypass RLS.
create or replace view public.wavo_public_profiles_v1
with (security_invoker = true)
as
select
  p.id,
  p.username,
  p.avatar_url,
  p.status,
  p.bio,
  p.created_at,
  p.equipped_theme,
  p.equipped_badge,
  p.equipped_name_style,
  p.show_online,
  case when p.show_online then p.last_active else null end as last_active,
  p.is_premium,
  p.tier
from public.profiles as p;
revoke all on table public.wavo_public_profiles_v1 from public, anon, authenticated;
grant select on table public.wavo_public_profiles_v1 to authenticated, service_role;
