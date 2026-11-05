-- Registration v2: store real names and dates of birth outside the broadly
-- readable profiles table. Keep synthetic @wavo.app authentication for
-- backwards-compatible username logins; recovery email is verified separately.
--
-- Deploy this migration BEFORE deploying the signup frontend.

create table if not exists public.account_identity (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null check (char_length(first_name) between 1 and 50),
  last_name text check (last_name is null or char_length(last_name) between 1 and 50),
  date_of_birth date not null,
  created_at timestamptz not null default now()
);

alter table public.account_identity enable row level security;
revoke all on table public.account_identity from anon, authenticated;
grant select on table public.account_identity to authenticated;

drop policy if exists "account identity self read" on public.account_identity;
create policy "account identity self read" on public.account_identity
  for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  uname text;
  bday date;
  internal_account boolean := false;
  recovery_address text;
  registration_v2 boolean := false;
  given_name text;
  family_name text;
begin
  uname := coalesce(
    nullif(new.raw_user_meta_data->>'username', ''),
    split_part(new.email, '@', 1)
  );
  registration_v2 := coalesce(new.raw_user_meta_data->>'signup_version', '') = '2';
  -- Only trusted app metadata, never editable user metadata, can control
  -- privileged flags. The +TEST_ prefix only affects analytics.
  internal_account := lower(coalesce(new.raw_app_meta_data->>'is_internal', 'false')) in ('true', '1', 'yes');

  if uname ~* '^\+test_' then
    if uname !~* '^\+test_[a-z0-9_]{3,24}$' then
      raise exception 'invalid_test_username';
    end if;
    internal_account := true;
    uname := lower(substring(uname from 7));
  elsif uname ~* '^test:' then
    uname := btrim(substring(uname from 6));
  end if;

  if uname is null or uname = '' then
    uname := split_part(new.email, '@', 1);
  end if;

  begin
    bday := nullif(new.raw_user_meta_data->>'birthday', '')::date;
  exception when others then
    bday := null;
  end;

  given_name := nullif(btrim(new.raw_user_meta_data->>'first_name'), '');
  family_name := nullif(btrim(new.raw_user_meta_data->>'last_name'), '');
  recovery_address := nullif(lower(btrim(new.raw_user_meta_data->>'real_email')), '');

  if registration_v2 then
    if uname !~ '^[a-z0-9_]{3,24}$' then
      raise exception 'invalid_signup_username';
    end if;
    if given_name is null or char_length(given_name) > 50
       or (family_name is not null and char_length(family_name) > 50) then
      raise exception 'invalid_signup_name';
    end if;
    if bday is null
       or bday > (current_date - interval '13 years')::date
       or bday < (current_date - interval '120 years')::date then
      raise exception 'invalid_signup_birth_date';
    end if;
    if recovery_address is null
       or recovery_address !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
       or recovery_address like '%@wavo.app' then
      raise exception 'invalid_signup_recovery_email';
    end if;
  end if;

  -- The existing profile table is readable by other signed-in users. For v2
  -- registrations, never place legal names or precise age/DOB on that row.
  insert into public.profiles (
    id, username, first_name, last_name, email, birthday, age, is_admin, is_internal
  )
  values (
    new.id,
    uname,
    case when registration_v2 then null else given_name end,
    case when registration_v2 then null else family_name end,
    null,
    case when registration_v2 then null else bday end,
    case when registration_v2 then null
         when bday is not null then extract(year from age(bday))::int
         else null end,
    false,
    internal_account
  )
  on conflict (id) do nothing;

  if registration_v2 then
    insert into public.account_identity (user_id, first_name, last_name, date_of_birth)
    values (new.id, given_name, family_name, bday);
  end if;

  if recovery_address is not null then
    insert into public.account_recovery (user_id, pending_recovery_email, updated_at)
    values (new.id, recovery_address, now())
    on conflict (user_id) do update
      set pending_recovery_email = excluded.pending_recovery_email,
          updated_at = now();
  end if;

  return new;
end;
$function$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
