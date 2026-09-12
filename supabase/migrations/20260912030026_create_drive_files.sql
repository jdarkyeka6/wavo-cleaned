create table if not exists public.drive_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  drive_file_id text not null unique,
  file_name text not null,
  mime_type text,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  created_at timestamptz not null default now()
);

create index if not exists drive_files_user_id_idx on public.drive_files(user_id);

alter table public.drive_files enable row level security;

revoke all on table public.drive_files from anon, authenticated;
grant select, insert, update, delete on table public.drive_files to service_role;
