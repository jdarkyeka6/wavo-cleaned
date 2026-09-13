create or replace function public.tier_rank(t text)
returns integer
language sql
immutable
set search_path to 'public'
as $function$
  select case lower(coalesce(t, 'free'))
    when 'pro' then 3
    when 'vip' then 3
    when 'plus' then 2
    when 'premium' then 2
    else 1
  end;
$function$;

create or replace function public.effective_tier(p_uid uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  t text;
  paid_ok boolean;
begin
  select lower(coalesce(tier, 'free')),
         (coalesce(is_premium, false) and (premium_until is null or premium_until > now()))
    into t, paid_ok
  from public.profiles where id = p_uid;

  if t is null then return 'free'; end if;
  if t in ('premium','plus','pro','vip') and not coalesce(paid_ok, false) then
    return 'free';
  end if;
  if t = 'vip' then return 'pro'; end if;
  return t;
end;
$function$;
