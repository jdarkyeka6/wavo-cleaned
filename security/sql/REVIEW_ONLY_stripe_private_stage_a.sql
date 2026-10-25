-- STAGED: NOT DEPLOYED. Apply before deploying new Stripe API code.
-- This creates a private, service-role-only billing ID store and copies old IDs
-- without removing any profile values. Safe to roll back the *code* after Stage A.
begin;
create table if not exists public.wavo_billing_customer_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text not null unique,
  updated_at timestamptz not null default now()
);
alter table public.wavo_billing_customer_links enable row level security;
revoke all on table public.wavo_billing_customer_links from public, anon, authenticated;
grant select, insert, update, delete on table public.wavo_billing_customer_links to service_role;
insert into public.wavo_billing_customer_links(user_id, stripe_customer_id)
select id, stripe_customer_id
from public.profiles
where stripe_customer_id is not null
on conflict (user_id) do update
set stripe_customer_id = excluded.stripe_customer_id, updated_at = now();
commit;
