-- Bucket publik untuk foto master barang.

INSERT INTO storage.buckets (id, name, public)
VALUES ('item-photos', 'item-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Baca: publik (untuk katalog publik & daftar barang).
DROP POLICY IF EXISTS "item-photos public read" ON storage.objects;
CREATE POLICY "item-photos public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'item-photos');

-- Upload/hapus: user terautentikasi dengan permission inventory.manage.
-- (Dicek di aplikasi; policy storage hanya batasi ke user login.)
DROP POLICY IF EXISTS "item-photos authenticated write" ON storage.objects;
CREATE POLICY "item-photos authenticated write"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'item-photos' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "item-photos authenticated update" ON storage.objects;
CREATE POLICY "item-photos authenticated update"
ON storage.objects FOR UPDATE
USING (bucket_id = 'item-photos' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "item-photos authenticated delete" ON storage.objects;
CREATE POLICY "item-photos authenticated delete"
ON storage.objects FOR DELETE
USING (bucket_id = 'item-photos' AND auth.role() = 'authenticated');
