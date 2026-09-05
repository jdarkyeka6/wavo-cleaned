-- Presence 2.0: opt-in live availability and activity sharing.
-- Raw rows are owner-only. Friends read masked data through get_visible_presence()
-- so disabled activity/music/gaming fields are never exposed to clients.

create table if not exists public.wavo_presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  availability text not null default 'active' check (availability in ('active','free','busy','away')),
  activity_kind text not null default 'status' check (activity_kind in ('status','gaming','music','school','sport','other')),
  activity_text text,
  activity_emoji text,
  share_presence boolean not null default false,
  share_activity boolean not null default false,
  share_music boolean not null default false,
  share_gaming boolean not null default false,
  audience_mode text not null default 'nobody' check (audience_mode in ('friends','selected','nobody')),
  audience uuid[] not null default '{}',
  last_seen timestamptz not null default now(),
  activity_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists wavo_presence_last_seen_idx on public.wavo_presence(last_seen desc);

alter table public.wavo_presence enable row level security;
revoke all on table public.wavo_presence from anon;
grant select, insert, update, delete on table public.wavo_presence to authenticated;

drop policy if exists "presence owner reads" on public.wavo_presence;
create policy "presence owner reads"
  on public.wavo_presence for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "presence owner inserts" on public.wavo_presence;
create policy "presence owner inserts"
  on public.wavo_presence for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "presence owner updates" on public.wavo_presence;
create policy "presence owner updates"
  on public.wavo_presence for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "presence owner deletes" on public.wavo_presence;
create policy "presence owner deletes"
  on public.wavo_presence for delete to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.get_visible_presence()
returns table (
  user_id uuid,
  availability text,
  activity_kind text,
  activity_text text,
  activity_emoji text,
  last_seen timestamptz,
  activity_expires_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    p.user_id,
    p.availability,
    case
      when p.share_activity
        and (p.activity_expires_at is null or p.activity_expires_at > now())
        and (p.activity_kind <> 'music' or p.share_music)
        and (p.activity_kind <> 'gaming' or p.share_gaming)
      then p.activity_kind
      else null
    end as activity_kind,
    case
      when p.share_activity
        and (p.activity_expires_at is null or p.activity_expires_at > now())
        and (p.activity_kind <> 'music' or p.share_music)
        and (p.activity_kind <> 'gaming' or p.share_gaming)
      then p.activity_text
      else null
    end as activity_text,
    case
      when p.share_activity
        and (p.activity_expires_at is null or p.activity_expires_at > now())
        and (p.activity_kind <> 'music' or p.share_music)
        and (p.activity_kind <> 'gaming' or p.share_gaming)
      then p.activity_emoji
      else null
    end as activity_emoji,
    p.last_seen,
    p.activity_expires_at
  from public.wavo_presence p
  where
    p.user_id = auth.uid()
    or (
      p.share_presence
      and p.audience_mode <> 'nobody'
      and not public.blocked_between(auth.uid(), p.user_id)
      and (
        (p.audience_mode = 'friends' and public.are_friends(auth.uid(), p.user_id))
        or
        (p.audience_mode = 'selected' and auth.uid() = any(p.audience) and public.are_friends(auth.uid(), p.user_id))
      )
    );
$$;

revoke all on function public.get_visible_presence() from public;
grant execute on function public.get_visible_presence() to authenticated;
