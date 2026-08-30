-- Private storage for nutrition photo analysis.
-- Files are user-scoped and are never publicly readable.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'nutrition-ai',
  'nutrition-ai',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = 8388608,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Users can upload nutrition AI photos"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'nutrition-ai'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
