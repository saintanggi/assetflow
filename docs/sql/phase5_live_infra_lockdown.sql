-- =============================================================================
-- MIGRASI FASE 5: LIVE INFRASTRUCTURE LOCKDOWN (100% NON-BREAKING, IDEMPOTEN)
-- =============================================================================

-- 1. Kunci tabel staging historis agar tidak dapat diakses lewat PostgREST publik
DO $$
BEGIN
  IF to_regclass('public.hist_staging') IS NOT NULL THEN
    ALTER TABLE public.hist_staging ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.hist_staging FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

-- 2. Batasi ukuran file (10 MB) dan tipe MIME aman pada 3 bucket Storage
--    (tidak memengaruhi file yang sudah ada di storage)
UPDATE storage.buckets
   SET file_size_limit = 10485760,
       allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
 WHERE id IN ('asset-photos', 'item-photos');

UPDATE storage.buckets
   SET file_size_limit = 10485760,
       allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
 WHERE id = 'surat-jalan';
