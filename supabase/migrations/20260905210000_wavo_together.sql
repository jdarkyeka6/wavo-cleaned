-- Wavo Together: Come?, expiring statuses, knocks, circles, drop-in rooms,
-- shared queues and lightweight chat games.

create table if not exists public.wavo_statuses (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 120),
  emoji text,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.friend_circles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  emoji text,
  created_at timestamptz not null default now()
);

create table if not exists public.friend_circle_members (
  circle_id uuid not null references public.friend_circles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (circle_id, user_id)
);

create table if not exists public.wavo_knocks (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  response text not null default 'pending' check (response in ('pending','call','five','cant')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  expires_at timestamptz not null default (now() + interval '2 hours'),
  constraint wavo_knocks_distinct_people check (sender_id <> receiver_id)
);

create table if not exists public.come_invites (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  location text,
  note text,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  audience uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint come_invites_time_order check (ends_at > starts_at)
);

create table if not exists public.come_responses (
  invite_id uuid not null references public.come_invites(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  response text not null check (response in ('yep','maybe','cant')),
  updated_at timestamptz not null default now(),
  primary key (invite_id, user_id)
);

create table if not exists public.dropin_rooms (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  audience uuid[] not null default '{}',
  is_open boolean not null default true,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists public.dropin_room_members (
  room_id uuid not null references public.dropin_rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.shared_queues (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default 'Shared queue' check (char_length(title) between 1 and 80),
  audience uuid[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.shared_queue_items (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid not null references public.shared_queues(id) on delete cascade,
  added_by uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  url text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_games (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles(id) on delete cascade,
  opponent_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('rps','coin')),
  state jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active','finished','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_games_distinct_people check (creator_id <> opponent_id)
);

create index if not exists wavo_knocks_receiver_idx on public.wavo_knocks(receiver_id, created_at desc);
create index if not exists come_invites_owner_idx on public.come_invites(owner_id, created_at desc);
create index if not exists dropin_rooms_open_idx on public.dropin_rooms(is_open, created_at desc);
create index if not exists shared_queue_items_queue_idx on public.shared_queue_items(queue_id, created_at);
create index if not exists chat_games_people_idx on public.chat_games(creator_id, opponent_id, created_at desc);

alter table public.wavo_statuses enable row level security;
alter table public.friend_circles enable row level security;
alter table public.friend_circle_members enable row level security;
alter table public.wavo_knocks enable row level security;
alter table public.come_invites enable row level security;
alter table public.come_responses enable row level security;
alter table public.dropin_rooms enable row level security;
alter table public.dropin_room_members enable row level security;
alter table public.shared_queues enable row level security;
alter table public.shared_queue_items enable row level security;
alter table public.chat_games enable row level security;

revoke all on table public.wavo_statuses, public.friend_circles, public.friend_circle_members,
  public.wavo_knocks, public.come_invites, public.come_responses, public.dropin_rooms,
  public.dropin_room_members, public.shared_queues, public.shared_queue_items, public.chat_games
  from anon;

grant select, insert, update, delete on table public.wavo_statuses, public.friend_circles,
  public.friend_circle_members, public.wavo_knocks, public.come_invites, public.come_responses,
  public.dropin_rooms, public.dropin_room_members, public.shared_queues, public.shared_queue_items,
  public.chat_games to authenticated;

create policy "status owner or friends read"
  on public.wavo_statuses for select to authenticated
  using (
    (select auth.uid()) = user_id
    or (
      expires_at > now()
      and public.are_friends((select auth.uid()), user_id)
      and not public.blocked_between((select auth.uid()), user_id)
    )
  );
create policy "status owner writes"
  on public.wavo_statuses for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "circle owner reads"
  on public.friend_circles for select to authenticated using ((select auth.uid()) = owner_id);
create policy "circle owner writes"
  on public.friend_circles for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "circle owner reads members"
  on public.friend_circle_members for select to authenticated
  using (exists (select 1 from public.friend_circles c where c.id = circle_id and c.owner_id = (select auth.uid())));
create policy "circle owner writes members"
  on public.friend_circle_members for all to authenticated
  using (exists (select 1 from public.friend_circles c where c.id = circle_id and c.owner_id = (select auth.uid())))
  with check (
    exists (select 1 from public.friend_circles c where c.id = circle_id and c.owner_id = (select auth.uid()))
    and public.are_friends((select auth.uid()), user_id)
  );

create policy "knock participants read"
  on public.wavo_knocks for select to authenticated
  using ((select auth.uid()) = sender_id or (select auth.uid()) = receiver_id);
create policy "friends send knocks"
  on public.wavo_knocks for insert to authenticated
  with check (
    (select auth.uid()) = sender_id
    and public.are_friends(sender_id, receiver_id)
    and not public.blocked_between(sender_id, receiver_id)
  );
create policy "receiver responds to knock"
  on public.wavo_knocks for update to authenticated
  using ((select auth.uid()) = receiver_id)
  with check ((select auth.uid()) = receiver_id);
create policy "knock participants delete"
  on public.wavo_knocks for delete to authenticated
  using ((select auth.uid()) = sender_id or (select auth.uid()) = receiver_id);

create policy "come invite visible to audience"
  on public.come_invites for select to authenticated
  using ((select auth.uid()) = owner_id or (select auth.uid()) = any(audience));
create policy "come invite owner inserts"
  on public.come_invites for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy "come invite owner updates"
  on public.come_invites for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "come invite owner deletes"
  on public.come_invites for delete to authenticated
  using ((select auth.uid()) = owner_id);

create policy "come responses visible to participants"
  on public.come_responses for select to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (select 1 from public.come_invites i where i.id = invite_id and i.owner_id = (select auth.uid()))
    or exists (select 1 from public.come_invites i where i.id = invite_id and (select auth.uid()) = any(i.audience))
  );
create policy "come audience responds"
  on public.come_responses for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.come_invites i
      where i.id = invite_id
        and ((select auth.uid()) = i.owner_id or (select auth.uid()) = any(i.audience))
        and i.ends_at > now()
    )
  );
create policy "come audience changes response"
  on public.come_responses for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "come responder deletes"
  on public.come_responses for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "dropin rooms visible"
  on public.dropin_rooms for select to authenticated
  using ((select auth.uid()) = owner_id or (select auth.uid()) = any(audience));
create policy "dropin room owner inserts"
  on public.dropin_rooms for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy "dropin room owner updates"
  on public.dropin_rooms for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "dropin room owner deletes"
  on public.dropin_rooms for delete to authenticated
  using ((select auth.uid()) = owner_id);

create policy "room members visible"
  on public.dropin_room_members for select to authenticated
  using (
    exists (
      select 1 from public.dropin_rooms r
      where r.id = room_id and ((select auth.uid()) = r.owner_id or (select auth.uid()) = any(r.audience))
    )
  );
create policy "audience joins room"
  on public.dropin_room_members for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.dropin_rooms r
      where r.id = room_id and r.is_open
        and ((select auth.uid()) = r.owner_id or (select auth.uid()) = any(r.audience))
    )
  );
create policy "member leaves room"
  on public.dropin_room_members for delete to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (select 1 from public.dropin_rooms r where r.id = room_id and r.owner_id = (select auth.uid()))
  );

create policy "shared queues visible"
  on public.shared_queues for select to authenticated
  using ((select auth.uid()) = owner_id or (select auth.uid()) = any(audience));
create policy "shared queue owner inserts"
  on public.shared_queues for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy "shared queue owner updates"
  on public.shared_queues for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "shared queue owner deletes"
  on public.shared_queues for delete to authenticated
  using ((select auth.uid()) = owner_id);

create policy "queue items visible"
  on public.shared_queue_items for select to authenticated
  using (
    exists (
      select 1 from public.shared_queues q
      where q.id = queue_id and ((select auth.uid()) = q.owner_id or (select auth.uid()) = any(q.audience))
    )
  );
create policy "queue audience adds"
  on public.shared_queue_items for insert to authenticated
  with check (
    (select auth.uid()) = added_by
    and exists (
      select 1 from public.shared_queues q
      where q.id = queue_id and q.is_active
        and ((select auth.uid()) = q.owner_id or (select auth.uid()) = any(q.audience))
    )
  );
create policy "queue owner or adder removes"
  on public.shared_queue_items for delete to authenticated
  using (
    (select auth.uid()) = added_by
    or exists (select 1 from public.shared_queues q where q.id = queue_id and q.owner_id = (select auth.uid()))
  );

create policy "game participants read"
  on public.chat_games for select to authenticated
  using ((select auth.uid()) = creator_id or (select auth.uid()) = opponent_id);
create policy "friends create games"
  on public.chat_games for insert to authenticated
  with check (
    (select auth.uid()) = creator_id
    and public.are_friends(creator_id, opponent_id)
    and not public.blocked_between(creator_id, opponent_id)
  );
create policy "game participants update"
  on public.chat_games for update to authenticated
  using ((select auth.uid()) = creator_id or (select auth.uid()) = opponent_id)
  with check ((select auth.uid()) = creator_id or (select auth.uid()) = opponent_id);
create policy "game participants delete"
  on public.chat_games for delete to authenticated
  using ((select auth.uid()) = creator_id or (select auth.uid()) = opponent_id);

-- Keep the fast-changing features live while the app is open.
do $$
declare
  t text;
begin
  foreach t in array array['wavo_statuses','wavo_knocks','come_invites','come_responses','dropin_rooms','dropin_room_members','shared_queues','shared_queue_items','chat_games']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
