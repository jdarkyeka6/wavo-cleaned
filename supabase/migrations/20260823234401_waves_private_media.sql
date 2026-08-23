alter table public.posts
  add column if not exists media_path text,
  add column if not exists media_type text,
  add column if not exists media_filename text,
  add column if not exists media_size_bytes bigint,
  add column if not exists video_duration_ms integer;

alter table public.posts
  drop constraint if exists posts_media_type_check,
  add constraint posts_media_type_check check (media_type is null or media_type in ('image','video')),
  drop constraint if exists posts_video_duration_check,
  add constraint posts_video_duration_check check (video_duration_ms is null or (video_duration_ms >= 0 and video_duration_ms <= 60000)),
  drop constraint if exists posts_media_size_check,
  add constraint posts_media_size_check check (media_size_bytes is null or (media_size_bytes >= 0 and media_size_bytes <= 52428800));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'wave-media',
  'wave-media',
  false,
  52428800,
  array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "wave media upload own posts"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'wave-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.posts p
    where p.id = case
      when split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then split_part(name, '/', 2)::uuid
      else null
    end
      and p.author_id = (select auth.uid())
  )
);

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
  )
);

create policy "wave media delete own files"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'wave-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
