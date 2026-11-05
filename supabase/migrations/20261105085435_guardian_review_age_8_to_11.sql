-- Self-attested guardian review for ages 8-11 and direct signup for ages 12+.
-- This does NOT independently verify that the person pressing the approval
-- button is a parent. Legal verification needs a separate implementation.
alter table public.account_identity
  add column if not exists guardian_acknowledged_at timestamptz;

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
  guardian_acknowledged boolean := false;
  given_name text;
  family_name text;
begin
  uname := coalesce(
    nullif(new.raw_user_meta_data->>'username', ''),
    split_part(new.email, '@', 1)
  );
  registration_v2 := coalesce(new.raw_user_meta_data->>'signup_version', '') = '2';
  -- This records an unverified, on-device acknowledgement, not proof of identity.
  guardian_acknowledged := lower(coalesce(new.raw_user_meta_data->>'guardian_acknowledged', 'false')) = 'true';
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
       or bday > (current_date - interval '8 years')::date
       or bday < (current_date - interval '120 years')::date then
      raise exception 'invalid_signup_birth_date';
    end if;
    -- The form requests a parent/guardian acknowledgement from children 8-11.
    -- This must not be represented as verifiable parental consent.
    if bday > (current_date - interval '12 years')::date
       and not guardian_acknowledged then
      raise exception 'guardian_acknowledgement_required';
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
    insert into public.account_identity (user_id, first_name, last_name, date_of_birth, guardian_acknowledged_at)
    values (new.id, given_name, family_name, bday,
            case when bday > (current_date - interval '12 years')::date and guardian_acknowledged
                 then now() else null end);
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
