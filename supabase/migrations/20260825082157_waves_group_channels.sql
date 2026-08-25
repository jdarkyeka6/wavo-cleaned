alter table public.posts
  add column if not exists group_id uuid references public.groups(id) on delete cascade;

alter table public.posts drop constraint if exists posts_visibility_check;
alter table public.posts
  add constraint posts_visibility_check
  check (visibility = any (array['friends'::text, 'selected'::text, 'group'::text]));

alter table public.posts drop constraint if exists posts_group_scope_check;
alter table public.posts
  add constraint posts_group_scope_check
  check (
    (visibility = 'group' and group_id is not null)
    or
    (visibility in ('friends', 'selected') and group_id is null)
  ) not valid;
alter table public.posts validate constraint posts_group_scope_check;

create index if not exists posts_group_created_idx
  on public.posts (group_id, created_at desc)
  where visibility = 'group';

create or replace function private.can_publish_post(
  p_author uuid,
  p_visibility text,
  p_group uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when u.uid is null then false
    when u.uid <> p_author then false
    when p_visibility in ('friends', 'selected') then p_group is null
    when p_visibility = 'group' then
      p_group is not null
      and exists (
        select 1
        from public.group_members gm
        where gm.group_id = p_group
          and gm.user_id = u.uid
      )
    else false
  end
  from (select auth.uid() as uid) u;
$$;

revoke all on function private.can_publish_post(uuid, text, uuid) from public;
grant execute on function private.can_publish_post(uuid, text, uuid) to authenticated;

create or replace function private.can_view_post(
  p_post uuid,
  p_author uuid,
  p_visibility text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when u.uid is null then false
    when u.uid = p_author then true
    when exists (
      select 1
      from public.blocks b
      where (b.blocker_id = u.uid and b.blocked_id = p_author)
         or (b.blocker_id = p_author and b.blocked_id = u.uid)
    ) then false
    when p_visibility = 'group' then exists (
      select 1
      from public.posts p
      join public.group_members gm on gm.group_id = p.group_id
      where p.id = p_post
        and p.author_id = p_author
        and p.group_id is not null
        and gm.user_id = u.uid
    )
    when p_visibility = 'friends' then exists (
      select 1
      from public.friend_requests fr
      where fr.status = 'accepted'
        and (
          (fr.sender_id = u.uid and fr.receiver_id = p_author)
          or (fr.receiver_id = u.uid and fr.sender_id = p_author)
        )
    )
    when p_visibility = 'selected' then
      exists (
        select 1
        from public.friend_requests fr
        where fr.status = 'accepted'
          and (
            (fr.sender_id = u.uid and fr.receiver_id = p_author)
            or (fr.receiver_id = u.uid and fr.sender_id = p_author)
          )
      )
      and exists (
        select 1
        from public.post_audience pa
        where pa.post_id = p_post
          and pa.author_id = p_author
          and pa.user_id = u.uid
      )
    else false
  end
  from (select auth.uid() as uid) u;
$$;

revoke all on function private.can_view_post(uuid, uuid, text) from public;
grant execute on function private.can_view_post(uuid, uuid, text) to authenticated;

drop policy if exists "users create own posts" on public.posts;
create policy "users create own posts" on public.posts
  for insert to authenticated
  with check (private.can_publish_post(author_id, visibility, group_id));

drop policy if exists "users update own posts" on public.posts;
create policy "users update own posts" on public.posts
  for update to authenticated
  using ((select auth.uid()) = author_id)
  with check (private.can_publish_post(author_id, visibility, group_id));
