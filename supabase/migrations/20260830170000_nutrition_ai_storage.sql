-- Private bucket for nutrition AI images.
-- Files are namespaced by authenticated user id: <user_id>/<uuid>.<ext>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('nutrition-ai', 'nutrition-ai', false, 8388608, array['image/jpeg','image/png','image/webp']::text[])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

DROP POLICY IF EXISTS "nutrition_ai_select_own" ON storage.objects;
DROP POLICY IF EXISTS "nutrition_ai_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "nutrition_ai_update_own" ON storage.objects;
DROP POLICY IF EXISTS "nutrition_ai_delete_own" ON storage.objects;

CREATE POLICY "nutrition_ai_select_own"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'nutrition-ai' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "nutrition_ai_insert_own"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'nutrition-ai' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "nutrition_ai_update_own"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'nutrition-ai' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'nutrition-ai' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "nutrition_ai_delete_own"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'nutrition-ai' AND (storage.foldername(name))[1] = auth.uid()::text);
