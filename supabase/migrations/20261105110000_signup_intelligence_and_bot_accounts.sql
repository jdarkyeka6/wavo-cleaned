-- Wavo signup intelligence and explicitly approved bot accounts.
-- No raw IP addresses or precise geolocation are collected.
alter table public.profiles
  add column if not exists account_type text not null default 'human';

alter table public.profiles
  drop constraint if exists profiles_account_type_check;
alter table public.profiles
  add constraint profiles_account_type_check
  check (account_type in ('human', 'official_bot', 'integration_bot'));

create table if not exists public.signup_intelligence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  signup_source text not null default 'unknown',
  referrer_host text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  landing_path text,
  user_agent text,
  email_verified_at timestamptz,
  automation_signals text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint signup_intelligence_source_length check (char_length(signup_source) <= 80),
  constraint signup_intelligence_referrer_length check (referrer_host is null or char_length(referrer_host) <= 255),
  constraint signup_intelligence_user_agent_length check (user_agent is null or char_length(user_agent) <= 512)
);

create index if not exists signup_intelligence_created_at_idx
  on public.signup_intelligence(created_at desc);
create index if not exists signup_intelligence_source_idx
  on public.signup_intelligence(signup_source);

alter table public.signup_intelligence enable row level security;
revoke all on public.signup_intelligence from anon, authenticated;
grant select on public.signup_intelligence to authenticated;

drop policy if exists "Admins can view signup intelligence" on public.signup_intelligence;
create policy "Admins can view signup intelligence"
  on public.signup_intelligence
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.is_admin = true
    )
  );

create or replace function public.capture_signup_intelligence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  app_meta jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
  kind text := coalesce(app_meta->>'account_type', 'human');
begin
  -- Basic honeypot for unsophisticated autofill bots; not a substitute for CAPTCHA.
  if nullif(meta->>'signup_trap', '') is not null then
    raise exception 'signup_validation_failed';
  end if;
  if kind not in ('human', 'official_bot', 'integration_bot') then
    kind := 'human';
  end if;

  update public.profiles
     set account_type = kind
   where id = new.id;

  insert into public.signup_intelligence (
    user_id, signup_source, referrer_host, utm_source, utm_medium,
    utm_campaign, landing_path, user_agent, email_verified_at,
    automation_signals, updated_at
  )
  values (
    new.id,
    case when kind in ('official_bot', 'integration_bot') then 'approved_bot'
         else left(coalesce(nullif(meta->>'signup_source', ''), 'unknown'), 80) end,
    left(nullif(meta->>'signup_referrer_host', ''), 255),
    left(nullif(meta->>'signup_utm_source', ''), 120),
    left(nullif(meta->>'signup_utm_medium', ''), 120),
    left(nullif(meta->>'signup_utm_campaign', ''), 120),
    left(nullif(meta->>'signup_landing_path', ''), 300),
    left(nullif(meta->>'signup_user_agent', ''), 512),
    new.email_confirmed_at,
    (case
      when kind in ('official_bot', 'integration_bot') then array['approved_bot_account']::text[]
      when new.email_confirmed_at is null then array['email_not_yet_verified']::text[]
      else '{}'::text[]
    end) ||
    (case
      when nullif(meta->>'signup_user_agent', '') is not null
       and (select count(*) from public.signup_intelligence s
            where s.user_agent = left(meta->>'signup_user_agent', 512)
              and s.created_at > now() - interval '10 minutes') >= 3
      then array['rapid_same_browser_signup_burst']::text[]
      else '{}'::text[]
    end),
    now()
  )
  on conflict (user_id) do update set
    email_verified_at = excluded.email_verified_at,
    automation_signals = case
      when excluded.email_verified_at is not null
        then array_remove(public.signup_intelligence.automation_signals, 'email_not_yet_verified')
      else public.signup_intelligence.automation_signals
    end,
    updated_at = now();

  return new;
end;
$$;

revoke all on function public.capture_signup_intelligence() from public, anon, authenticated;

drop trigger if exists z_capture_signup_intelligence on auth.users;
create trigger z_capture_signup_intelligence
  after insert or update of email_confirmed_at, raw_app_meta_data
  on auth.users
  for each row execute function public.capture_signup_intelligence();


-- Existing accounts predate source attribution; show them as legacy/unknown
-- instead of silently omitting them from the admin view.
insert into public.signup_intelligence (
  user_id, signup_source, email_verified_at, automation_signals
)
select
  u.id,
  'legacy_existing',
  u.email_confirmed_at,
  case when u.email_confirmed_at is null
       then array['email_not_yet_verified','legacy_signup_no_attribution']::text[]
       else array['legacy_signup_no_attribution']::text[] end
from auth.users u
join public.profiles p on p.id = u.id
on conflict (user_id) do nothing;
