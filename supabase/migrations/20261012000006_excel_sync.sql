-- =============================================================
-- 0006: Sinkronisasi model dengan Excel LIVE_STOCK_ASSET_WAREHOUSE
-- Menambah kolom yang dipakai alur Excel agar migrasi & input
-- harian (KARTU STOK) bisa berjalan penuh di sistem.
-- =============================================================

-- 1) Master barang: kolom brand & purchase_price SUDAH ADA di inventory_items
--    (dipakai untuk MEREK ITEM dari DATABASE dan HARGA dari DAFTAR HARGA).
--    Tambahan: satuan ROLL belum ada di master units.
INSERT INTO public.units (code, name, allow_decimal)
VALUES ('roll', 'Roll', false)
ON CONFLICT (code) DO NOTHING;

-- 2) Baris transaksi (sheet KARTU STOK):
--    resi (bisa multi nomor), gerai (NAMA GERAI tujuan),
--    status_aset (ASSET BARU / ASSET RETUR / UNREADY).
ALTER TABLE public.inventory_transaction_items
  ADD COLUMN IF NOT EXISTS resi text,
  ADD COLUMN IF NOT EXISTS gerai text,
  ADD COLUMN IF NOT EXISTS status_aset text
    CHECK (status_aset IS NULL OR status_aset IN ('ASSET BARU', 'ASSET RETUR', 'UNREADY'));

COMMENT ON COLUMN public.inventory_transaction_items.resi IS 'No resi pengiriman per baris (Excel KARTU STOK: RESI; bisa beberapa nomor dipisah baris baru)';
COMMENT ON COLUMN public.inventory_transaction_items.gerai IS 'Nama gerai/cabang tujuan atau asal (Excel KARTU STOK: NAMA GERAI)';
COMMENT ON COLUMN public.inventory_transaction_items.status_aset IS 'Status aset Excel: ASSET BARU / ASSET RETUR / UNREADY';

-- 3) Lokasi gudang (sheet AREA BLOK / AREA RAK):
--    blok area, luas, kapasitas pallet.
ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS blok text,
  ADD COLUMN IF NOT EXISTS luas text,
  ADD COLUMN IF NOT EXISTS kapasitas_pallet numeric(15,3)
    CHECK (kapasitas_pallet IS NULL OR kapasitas_pallet >= 0);

COMMENT ON COLUMN public.locations.blok IS 'Kode blok area gudang, cth "A1" (Excel AREA BLOK)';
COMMENT ON COLUMN public.locations.luas IS 'Dimensi area, cth "6,9m x 11,6m" (Excel AREA BLOK: LUAS)';
COMMENT ON COLUMN public.locations.kapasitas_pallet IS 'Kapasitas pallet area (Excel AREA BLOK: QTY PALLET)';

-- 4) RPC post_inventory_transaction: terima resi/gerai/status_aset per item.
--    p_items: [{item_id, qty, unit_price?, notes?, resi?, gerai?, status_aset?}]
CREATE OR REPLACE FUNCTION public.post_inventory_transaction(
  p_idempotency_key   text,
  p_type              text,
  p_transaction_date  date,
  p_source_location_id uuid,
  p_dest_location_id   uuid,
  p_reference         text,
  p_notes             text,
  p_items             jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
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
      reference, notes, idempotency_key, created_by, posted_at
    )
    VALUES (
      v_doc, p_type, 'posted', COALESCE(p_transaction_date, CURRENT_DATE),
      p_source_location_id, p_dest_location_id,
      NULLIF(btrim(COALESCE(p_reference, '')), ''),
      NULLIF(btrim(COALESCE(p_notes, '')), ''),
      v_key, auth.uid(), now()
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
$$;
REVOKE ALL ON FUNCTION public.post_inventory_transaction(text, text, date, uuid, uuid, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_inventory_transaction(text, text, date, uuid, uuid, text, text, jsonb) TO authenticated;
