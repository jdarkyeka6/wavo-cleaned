-- STAGED: NOT DEPLOYED. Requires new checkout & cancellation API in production
-- and validated service-role read/write access to wavo_billing_customer_links.
-- Under no circumstances run until billing regression tests pass.
-- Prevent new IDs from being written to broadly readable profile rows.
begin;
do $$
begin
  if exists (
    select 1 from public.profiles p
    left join public.wavo_billing_customer_links b on b.user_id = p.id
    where p.stripe_customer_id is not null
      and b.stripe_customer_id is distinct from p.stripe_customer_id
  ) then
    raise exception 'Billing migration mismatch: refusing to clear public profile IDs';
  end if;
end;
$$;

create or replace function public.wavo_require_private_billing_store()
returns trigger language plpgsql security invoker
set search_path=pg_catalog
as $$
begin
  if new.stripe_customer_id is not null then
    raise exception 'Billing IDs belong in protected billing store'
      using errcode='42501';
  end if;
  return new;
end;
$$;
drop trigger if exists wavo_private_billing_guard on public.profiles;
create trigger wavo_private_billing_guard
before insert or update of stripe_customer_id on public.profiles
for each row execute function public.wavo_require_private_billing_store();

-- Private table holds verified copies. Old native profile SELECT * still works,
-- but returns null for the billing ID (not a PII-bearing customer reference).
update public.profiles
set stripe_customer_id = null
where stripe_customer_id is not null;
commit;
