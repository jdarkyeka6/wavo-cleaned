alter table public.posts
  drop constraint if exists posts_body_check;

alter table public.posts
  add constraint posts_body_check
  check (char_length(trim(both from body)) <= 2000);

-- Keep private Wave media readable only when the underlying post is visible
-- to the current authenticated user.
drop policy if exists "wave media read visible posts" on storage.objects;

create policy "wave media read visible posts"
on storage.objects for select
to authenticated
using (
  bucket_id = 'wave-media'
  and storage.allow_any_operation(array['object.get_authenticated_info','object.get_authenticated'])
  and exists (
    select 1
    from public.posts p
    where p.id = case
      when split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then split_part(name, '/', 2)::uuid
      else null
    end
      and private.can_view_post(p.id, p.author_id, p.visibility)
  )
);
