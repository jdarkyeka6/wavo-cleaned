create table if not exists public.audience_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 32),
  member_usernames text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

alter table public.audience_presets enable row level security;

grant select, insert, update, delete on table public.audience_presets to authenticated;

create policy "users can view own audience presets"
on public.audience_presets for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "users can create own audience presets"
on public.audience_presets for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "users can update own audience presets"
on public.audience_presets for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "users can delete own audience presets"
on public.audience_presets for delete
to authenticated
using ((select auth.uid()) = user_id);
