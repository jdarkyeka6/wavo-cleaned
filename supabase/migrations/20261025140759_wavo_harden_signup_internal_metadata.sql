-- Wavo signup trust boundary security fix.
-- Only server-controlled auth.users.raw_app_meta_data can mark an internal account.
-- Preserve username formatting, birthday and account recovery behavior.
-- Existing accounts are unchanged.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uname text;
  bday date;
  internal_account boolean := false;
  recovery_address text;
begin
  uname := coalesce(nullif(new.raw_user_meta_data->>'username', ''), split_part(new.email, '@', 1));
  internal_account := lower(coalesce(new.raw_app_meta_data->>'is_internal', 'false')) in ('true', '1', 'yes');
  if uname ~* '^test:' then
    -- A user-supplied display-name prefix must not grant trusted roles.
    uname := btrim(substring(uname from 6));
  end if;
  if uname is null or uname = '' then uname := split_part(new.email, '@', 1); end if;
  begin
    bday := nullif(new.raw_user_meta_data->>'birthday', '')::date;
  exception when others then
    bday := null;
  end;
  recovery_address := nullif(lower(btrim(new.raw_user_meta_data->>'real_email')), '');
  insert into public.profiles (id, username, first_name, last_name, email, birthday, age, is_admin, is_internal)
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
    on conflict (user_id) do update set pending_recovery_email = excluded.pending_recovery_email, updated_at = now();
  end if;
  return new;
end;
$function$
;
