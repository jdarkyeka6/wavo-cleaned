-- Wavo Batch 3: temporary location sharing + richer turn-based chat games.
-- Location rows are short-lived and only visible to explicitly selected friends.

create table if not exists public.temporary_location_shares (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  audience uuid[] not null default '{}',
  label text not null default 'I’m here' check (char_length(label) between 1 and 80),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  precision_m integer not null default 250 check (precision_m between 5 and 5000),
  approximate boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint temporary_location_expiry check (expires_at > created_at)
);

create index if not exists temporary_location_expires_idx
  on public.temporary_location_shares(expires_at);

alter table public.temporary_location_shares enable row level security;
revoke all on table public.temporary_location_shares from anon;
grant select, insert, update, delete on table public.temporary_location_shares to authenticated;

create policy "temporary location owner reads"
  on public.temporary_location_shares for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "temporary location selected friends read"
  on public.temporary_location_shares for select to authenticated
  using (
    expires_at > now()
    and (select auth.uid()) = any(audience)
    and public.are_friends(owner_id, (select auth.uid()))
    and not public.blocked_between(owner_id, (select auth.uid()))
  );

create policy "temporary location owner inserts"
  on public.temporary_location_shares for insert to authenticated
  with check (
    (select auth.uid()) = owner_id
    and cardinality(audience) <= 200
    and not exists (
      select 1
      from unnest(audience) as viewer_id
      where viewer_id = owner_id
        or not public.are_friends(owner_id, viewer_id)
        or public.blocked_between(owner_id, viewer_id)
    )
  );

create policy "temporary location owner updates"
  on public.temporary_location_shares for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check (
    (select auth.uid()) = owner_id
    and cardinality(audience) <= 200
    and not exists (
      select 1
      from unnest(audience) as viewer_id
      where viewer_id = owner_id
        or not public.are_friends(owner_id, viewer_id)
        or public.blocked_between(owner_id, viewer_id)
    )
  );

create policy "temporary location owner deletes"
  on public.temporary_location_shares for delete to authenticated
  using ((select auth.uid()) = owner_id);

-- Existing game rows stay valid; Batch 3 adds proper board games.
alter table public.chat_games drop constraint if exists chat_games_kind_check;
alter table public.chat_games
  add constraint chat_games_kind_check
  check (kind in ('rps','coin','tic_tac_toe','connect4'));

-- Make active location changes appear immediately while Wavo is open.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'temporary_location_shares'
  ) then
    alter publication supabase_realtime add table public.temporary_location_shares;
  end if;
end;
$$;
