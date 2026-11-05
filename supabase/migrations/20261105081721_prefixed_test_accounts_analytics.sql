-- Treat +TEST_name signups as internal for founder metrics without granting
-- arbitrary client-supplied is_internal metadata any authority.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uname text;
  bday date;
  internal_account boolean := false;
  recovery_address text;
begin
  uname := coalesce(nullif(btrim(new.raw_user_meta_data->>'username'), ''), split_part(new.email, '@', 1));

  -- Retain the October hardening: only trusted app metadata may set the
  -- internal flag directly. The explicit +TEST_ signup prefix is a
  -- separate analytics-only opt-out, never an admin permission.
  internal_account := lower(coalesce(new.raw_app_meta_data->>'is_internal', 'false')) in ('true', '1', 'yes');

  if uname ~* '^\+test_' then
    if uname !~* '^\+test_[a-z0-9_]{3,24}$' then
      raise exception 'Test account names must be +TEST_name with 3-24 letters, numbers or underscores';
    end if;
    internal_account := true;
    uname := lower(substring(uname from 7));
  elsif uname ~* '^test:' then
    -- Keep legacy test: name parsing without restoring untrusted flags.
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

  recovery_address := nullif(lower(btrim(new.raw_user_meta_data->>'real_email')), '');

  insert into public.profiles (
    id, username, first_name, last_name, email, birthday, age, is_admin, is_internal
  )
  values (
    new.id,
    uname,
    nullif(new.raw_user_meta_data->>'first_name', ''),
    nullif(new.raw_user_meta_data->>'last_name', ''),
    null,
    bday,
    case when bday is not null then extract(year from age(bday))::int else null end,
    false,
    internal_account
  )
  on conflict (id) do nothing;

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

-- Any existing profiles with the literal prefix must also be excluded.
update public.profiles
set is_internal = true
where username ~* '^\+test_'
  and is_internal is distinct from true;