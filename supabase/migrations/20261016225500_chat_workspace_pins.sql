-- Personal pinned-message shortcuts, never visible across accounts.
create table if not exists public.chat_message_pins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('dm','space')),
  target_id text not null,
  message_id uuid not null,
  created_at timestamptz not null default now(),
  unique(user_id,kind,message_id)
);
create index if not exists chat_message_pins_lookup
  on public.chat_message_pins (user_id,kind,target_id);
alter table public.chat_message_pins enable row level security;
create policy "users see own pinned messages" on public.chat_message_pins
  for select to authenticated using (user_id = auth.uid());
create policy "users pin own message shortcuts" on public.chat_message_pins
  for insert to authenticated with check (user_id = auth.uid());
create policy "users remove own pinned messages" on public.chat_message_pins
  for delete to authenticated using (user_id = auth.uid());
grant select,insert,delete on public.chat_message_pins to authenticated;
