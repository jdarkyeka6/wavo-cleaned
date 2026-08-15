-- Avatar uploads have been failing with "new row violates row-level security
-- policy". The cause is not the INSERT policy, which is correct.
--
-- supabase-js sends `upsert: true`, so storage-api runs:
--
--   INSERT INTO storage.objects (...) VALUES (...)
--   ON CONFLICT (name, bucket_id) DO UPDATE SET ...
--
-- and PostgreSQL evaluates SELECT policies as a conflict check on any INSERT
-- carrying an ON CONFLICT clause — before, and regardless of, whether a
-- conflicting row actually exists. storage.objects had RLS enabled with an
-- INSERT policy and an UPDATE policy but no SELECT policy at all, so that check
-- had nothing to satisfy it and every upload was rejected.
--
-- Confirmed by isolating the statement against the live schema as the
-- authenticated role:
--
--   plain INSERT                      -> OK
--   INSERT .. ON CONFLICT DO UPDATE   -> 42501
--   INSERT .. ON CONFLICT DO NOTHING  -> 42501   (no conflicting row exists)
--
-- and by adding the policy below inside a transaction, after which both a first
-- upload and a second upload over the same key succeed.
--
-- This also explains the state of the bucket: no object has ever had
-- updated_at > created_at, because no upsert has ever completed.

-- Scoped to avatars deliberately. The bucket is public and its object names are
-- '<user id>.<ext>', which anyone can already derive from a profile, so being
-- able to read the row adds no exposure.
--
-- chat-files is NOT given one. Its names embed chat ids and original filenames,
-- and a bucket-wide SELECT would turn URLs that are merely public into a list
-- anyone signed in could enumerate. It does not need one either: those uploads
-- use a unique timestamped path and never upsert, so they take the plain INSERT
-- path that already works.
drop policy if exists "avatars read" on storage.objects;
create policy "avatars read"
  on storage.objects
  for select
  using (bucket_id = 'avatars');
