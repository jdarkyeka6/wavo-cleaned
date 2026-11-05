-- Security hardening for Wavo profiles.
-- Login/signup trigger (SECURITY DEFINER) may insert as postgres. Its trusted
-- status is determined separately by wavo_harden_signup_internal_metadata.
-- No RLS policy widening; normal editable profile fields remain editable.
create or replace function public.wavo_guard_privileged_profile_insert()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $guard$
begin
 if current_user not in ('postgres','service_role','supabase_admin') then
   new.is_admin := false;
   new.is_employee := false;
   new.is_internal := false;
   new.is_fictional_character := false;
   new.support_unlimited := false;
   new.banned := false;
   new.banned_until := null;
   new.is_premium := false;
   new.premium_until := null;
   new.tier := 'free';
   new.entitlement_source := null;
   new.stripe_customer_id := null;
   new.email := null;
   new.username_changed_at := null;
 end if;
 return new;
end;
$guard$;
drop trigger if exists wavo_guard_privileged_profile_insert on public.profiles;
create trigger wavo_guard_privileged_profile_insert before insert on public.profiles
for each row execute function public.wavo_guard_privileged_profile_insert();

create or replace function public.wavo_guard_privileged_profile_update()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $guard$
begin
 if current_user not in ('postgres','service_role','supabase_admin')
    and not coalesce(public.is_admin((select auth.uid())),false)
    and (
      new.banned is distinct from old.banned
      or new.banned_until is distinct from old.banned_until
      or new.support_unlimited is distinct from old.support_unlimited
      or new.is_internal is distinct from old.is_internal
      or new.is_fictional_character is distinct from old.is_fictional_character
      or new.email is distinct from old.email
      or new.created_at is distinct from old.created_at
    )
 then
    raise exception 'Profile field is managed by Wavo administrators'
      using errcode='42501';
 end if;
 return new;
end;
$guard$;
drop trigger if exists wavo_guard_privileged_profile_update on public.profiles;
create trigger wavo_guard_privileged_profile_update before update on public.profiles
for each row execute function public.wavo_guard_privileged_profile_update();
