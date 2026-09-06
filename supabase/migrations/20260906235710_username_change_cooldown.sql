alter table public.profiles
  add column if not exists username_changed_at timestamptz;

comment on column public.profiles.username_changed_at is
  'Last successful self-serve username change. Used to enforce username-change cooldown.';
