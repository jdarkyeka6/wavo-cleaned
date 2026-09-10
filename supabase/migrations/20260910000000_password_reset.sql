-- Password reset functionality with email verification
create table if not exists public.password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  email text not null,
  token text not null unique,
  is_used boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  ip_address text
);

-- Create index for faster token lookups
create index if not exists password_reset_tokens_token_idx
  on public.password_reset_tokens (token);
create index if not exists password_reset_tokens_user_id_idx
  on public.password_reset_tokens (user_id);
create index if not exists password_reset_tokens_expires_at_idx
  on public.password_reset_tokens (expires_at);

-- Enable RLS
alter table public.password_reset_tokens enable row level security;

-- Only allow access to own reset tokens (for verification)
create policy "Users can view their own password reset tokens"
  on public.password_reset_tokens
  for select
  using (user_id = auth.uid());

-- Only server can insert/update (via Edge Function)
revoke all on table public.password_reset_tokens from anon, authenticated;

-- Create function to invalidate all tokens for a user
create or replace function public.invalidate_password_reset_tokens(user_id_param uuid)
returns void as $$
begin
  update public.password_reset_tokens
  set is_used = true, used_at = now()
  where user_id = user_id_param
    and is_used = false
    and expires_at > now();
end;
$$ language plpgsql security definer;

-- Add password reset attempt tracking for rate limiting
create table if not exists public.password_reset_attempts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  ip_address text,
  created_at timestamptz not null default now()
);

create index if not exists password_reset_attempts_email_created_idx
  on public.password_reset_attempts (email, created_at desc);
create index if not exists password_reset_attempts_ip_created_idx
  on public.password_reset_attempts (ip_address, created_at desc);

alter table public.password_reset_attempts enable row level security;
revoke all on table public.password_reset_attempts from anon, authenticated;
