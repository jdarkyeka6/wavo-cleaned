-- Disposable PostgreSQL fixture for the candidate Wavo board-game guard.
-- Runs only in CI's temporary Postgres service, never against production.
create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

create table public.chat_games (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null,
  opponent_id uuid not null,
  kind text not null check (kind in ('rps','coin','tic_tac_toe','connect4')),
  state jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (creator_id <> opponent_id)
);
grant select,insert,update,delete on public.chat_games to authenticated;
