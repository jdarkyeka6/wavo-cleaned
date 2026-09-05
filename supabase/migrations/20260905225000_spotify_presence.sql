-- Batch 2: secure Spotify connection state.
-- OAuth tokens never leave server-side storage. The app only receives status
-- and short-lived currently-playing metadata via activity_now.

create table if not exists public.spotify_connections (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  spotify_user_id text,
  display_name text,
  access_token text not null,
  refresh_token text not null,
  token_type text not null default 'Bearer',
  scope text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.spotify_oauth_states (
  state text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  created_at timestamptz not null default now()
);

create index if not exists spotify_oauth_states_expiry_idx
  on public.spotify_oauth_states(expires_at);

alter table public.spotify_connections enable row level security;
alter table public.spotify_oauth_states enable row level security;

-- Tokens and OAuth state are Edge Function only. service_role bypasses RLS.
revoke all on table public.spotify_connections, public.spotify_oauth_states from anon, authenticated;

create or replace function public.cleanup_expired_spotify_oauth_states()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.spotify_oauth_states where expires_at <= now();
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.cleanup_expired_spotify_oauth_states() from public, anon, authenticated;
