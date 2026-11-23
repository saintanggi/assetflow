-- Bukti foto Surat Jalan untuk transaksi Barang Masuk / Barang Keluar.
-- 23 Nov 2026 (permintaan Anggi): setiap Barang Masuk & Barang Keluar yang
-- diinput lewat form transaksi WAJIB melampirkan foto surat jalan (untuk
-- Barang Masuk boleh foto surat jalan atau foto nomor PO). Tanpa foto,
-- transaksi tidak bisa diposting (validasi di form). Foto tersimpan di
-- bucket Storage publik "surat-jalan" dan URL-nya tercatat di transaksi,
-- sehingga bisa dilihat dari menu mana pun yang menampilkan transaksi.
--
-- Alur lain (upload dokumen pengiriman, Kirim Cepat, Kartu Stok, Stok
-- Kondisi, koreksi admin) TIDAK berubah: parameter baru di RPC bersifat
-- opsional (default NULL), jadi pemanggil lama tetap jalan.

-- 1. Kolom URL foto bukti di transaksi.
ALTER TABLE public.inventory_transactions
  ADD COLUMN IF NOT EXISTS surat_jalan_url text;

-- 2. Bucket publik untuk foto surat jalan (pola sama seperti item-photos).
INSERT INTO storage.buckets (id, name, public)
VALUES ('surat-jalan', 'surat-jalan', true)
ON CONFLICT (id) DO NOTHING;

-- Baca: publik (agar foto bukti bisa dilihat dari menu mana pun).
DROP POLICY IF EXISTS "surat-jalan public read" ON storage.objects;
CREATE POLICY "surat-jalan public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'surat-jalan');

-- Upload/ubah/hapus: user login dengan permission inventory (pola item-photos
-- yang diperketat 20261015000028).
DROP POLICY IF EXISTS "surat-jalan authenticated write" ON storage.objects;
CREATE POLICY "surat-jalan authenticated write"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'surat-jalan'
  AND (
    public.has_permission('inventory.manage')
    OR public.has_permission('inventory.adjust')
    OR public.has_permission('settings.manage')
    OR public.is_super_admin()
  )
);

DROP POLICY IF EXISTS "surat-jalan authenticated update" ON storage.objects;
CREATE POLICY "surat-jalan authenticated update"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'surat-jalan'
  AND (
    public.has_permission('inventory.manage')
    OR public.has_permission('inventory.adjust')
    OR public.has_permission('settings.manage')
    OR public.is_super_admin()
  )
);

DROP POLICY IF EXISTS "surat-jalan authenticated delete" ON storage.objects;
CREATE POLICY "surat-jalan authenticated delete"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'surat-jalan'
  AND (
    public.has_permission('inventory.manage')
    OR public.has_permission('inventory.adjust')
    OR public.has_permission('settings.manage')
    OR public.is_super_admin()
  )
);

-- 3. RPC post_inventory_transaction: terima URL foto bukti (opsional).
--    Tanda tangan lama (8 argumen) dihapus dulu supaya tidak ada overload.
DROP FUNCTION IF EXISTS public.post_inventory_transaction(text, text, date, uuid, uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS public.post_inventory_transaction(text, text, date, uuid, uuid, text, text, jsonb, text);
CREATE FUNCTION public.post_inventory_transaction(
  p_idempotency_key text,
  p_type text,
  p_transaction_date date,
  p_source_location_id uuid,
  p_dest_location_id uuid,
  p_reference text,
  p_notes text,
  p_items jsonb,
  p_surat_jalan_url text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_key      text := COALESCE(
                       NULLIF(btrim(COALESCE(p_idempotency_key, '')), ''),
                       'auto-' || gen_random_uuid()::text);
  v_existing text;
  v_txn_id   uuid;
  v_doc      text;
  v_req      text;
  v_prefix   text;
BEGIN
  IF p_type NOT IN ('in', 'out', 'transfer', 'adjust', 'opname', 'return') THEN
    RAISE EXCEPTION 'Tipe transaksi tidak valid: %', p_type;
  END IF;

  v_req := public._txn_required_permission(p_type);
  IF NOT public.has_permission(v_req) THEN
    RAISE EXCEPTION 'Izin ditolak: butuh permission % untuk transaksi tipe %', v_req, p_type;
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Daftar item transaksi kosong';
  END IF;

  IF p_type = 'in' AND (p_dest_location_id IS NULL OR p_source_location_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Barang masuk: dest_location wajib diisi, source_location harus kosong';
  END IF;
  IF p_type = 'out' AND (p_source_location_id IS NULL OR p_dest_location_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Barang keluar: source_location wajib diisi, dest_location harus kosong';
  END IF;
  IF p_type = 'transfer'
     AND (p_source_location_id IS NULL OR p_dest_location_id IS NULL
          OR p_source_location_id = p_dest_location_id) THEN
    RAISE EXCEPTION 'Transfer: source & dest wajib diisi dan harus berbeda';
  END IF;
  IF p_type IN ('adjust', 'opname')
     AND (p_source_location_id IS NULL) = (p_dest_location_id IS NULL) THEN
    RAISE EXCEPTION 'Adjust/opname: isi tepat satu lokasi (source atau dest)';
  END IF;
  IF p_type = 'return' AND (p_dest_location_id IS NULL OR p_source_location_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Retur: dest_location wajib diisi, source_location harus kosong';
  END IF;

  SELECT doc_number INTO v_existing
  FROM public.inventory_transactions
  WHERE idempotency_key = v_key;
  IF FOUND THEN
    RETURN v_existing;
  END IF;

  v_prefix := CASE p_type
    WHEN 'in' THEN 'IN' WHEN 'out' THEN 'OUT' WHEN 'transfer' THEN 'TRF'
    WHEN 'adjust' THEN 'ADJ' WHEN 'opname' THEN 'OPN' WHEN 'return' THEN 'RTN'
  END;
  v_doc := public.next_doc_number(v_prefix);

  BEGIN
    INSERT INTO public.inventory_transactions (
      doc_number, type, status, transaction_date,
      source_location_id, dest_location_id,
      reference, notes, idempotency_key, created_by, posted_at,
      surat_jalan_url
    )
    VALUES (
      v_doc, p_type, 'posted', COALESCE(p_transaction_date, CURRENT_DATE),
      p_source_location_id, p_dest_location_id,
      NULLIF(btrim(COALESCE(p_reference, '')), ''),
      NULLIF(btrim(COALESCE(p_notes, '')), ''),
      v_key, auth.uid(), now(),
      NULLIF(btrim(COALESCE(p_surat_jalan_url, '')), '')
    )
    RETURNING id INTO v_txn_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT doc_number INTO v_existing
    FROM public.inventory_transactions
    WHERE idempotency_key = v_key;
    IF FOUND THEN
      RETURN v_existing;
    END IF;
    RAISE;
  END;

  INSERT INTO public.inventory_transaction_items
    (transaction_id, item_id, qty, unit_price, notes, resi, gerai, status_aset)
  SELECT
    v_txn_id,
    NULLIF(e ->> 'item_id', '')::uuid,
    (e ->> 'qty')::numeric,
    NULLIF(e ->> 'unit_price', '')::numeric,
    NULLIF(btrim(COALESCE(e ->> 'notes', '')), ''),
    NULLIF(btrim(COALESCE(e ->> 'resi', '')), ''),
    NULLIF(btrim(COALESCE(e ->> 'gerai', '')), ''),
    NULLIF(btrim(COALESCE(e ->> 'status_aset', '')), '')
  FROM jsonb_array_elements(p_items) AS e;

  PERFORM public._apply_posted_effects(v_txn_id);

  RETURN v_doc;
END;
$function$;

REVOKE ALL ON FUNCTION public.post_inventory_transaction(text, text, date, uuid, uuid, text, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_inventory_transaction(text, text, date, uuid, uuid, text, text, jsonb, text) TO authenticated;
