-- =============================================================
-- 20261125000002 — Kirim Cepat: sisa qty tidak boleh hilang
-- =============================================================
-- BUG: quick_ship_request() menyetel qty_approved = qty yang dikirim.
-- Kalau admin mengirim qty lebih kecil dari yang diminta (stok tidak cukup),
-- `ship_request_items` menandai baris 'terkirim' karena qty_shipped sudah
-- mencapai qty_approved — sehingga SISA permintaan HILANG dari menu
-- "Sisa Belum Terkirim" dan tidak pernah bisa dikirim susulan.
--
-- PERBAIKAN: qty_approved = GREATEST(qty_requested, qty_kirim). Dengan begitu
-- setelah pengiriman, baris yang belum lengkap otomatis berstatus
-- 'pending_sebagian' (oleh ship_request_items) dan sisanya tetap muncul di
-- Sisa Belum Terkirim. Bila qty kirim = qty permintaan, perilakunya sama
-- seperti sebelumnya.
--
-- Satu-satunya perubahan dari 20261103000002: ekspresi qty_approved.

DROP FUNCTION IF EXISTS public.quick_ship_request(uuid, jsonb, text, uuid[]);

CREATE FUNCTION public.quick_ship_request(
  p_request_id uuid,
  p_lines      jsonb,
  p_notes      text DEFAULT NULL,
  p_skip_ids   uuid[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_line  jsonb;
  v_ri_id uuid;
  v_qty   numeric;
  v_resi  text;
  v_barcode text;
  v_sn    text;
  v_txn   uuid;
  v_count int := 0;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Kirim cepat hanya untuk super admin';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Tidak ada item untuk dikirim';
  END IF;

  -- 1) Approve otomatis + simpan resi/barcode/SN untuk item yang dikirim.
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_ri_id := (v_line->>'request_item_id')::uuid;
    v_qty   := (v_line->>'qty')::numeric;
    v_resi  := NULLIF(btrim(COALESCE(v_line->>'resi', '')), '');
    v_barcode := NULLIF(btrim(COALESCE(v_line->>'barcode', '')), '');
    v_sn    := NULLIF(btrim(COALESCE(v_line->>'serial_number', '')), '');

    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Qty kirim harus lebih dari 0';
    END IF;
    IF v_resi IS NULL THEN
      RAISE EXCEPTION 'No resi wajib diisi';
    END IF;
    IF v_barcode IS NULL THEN
      RAISE EXCEPTION 'Barcode wajib diisi';
    END IF;

    UPDATE public.request_items
       SET -- Jangan turunkan qty disetujui ke qty kirim: sisa permintaan harus
           -- tetap tercatat agar muncul di "Sisa Belum Terkirim".
           qty_approved = GREATEST(qty_requested, v_qty),
           item_status  = 'disetujui',
           resi         = v_resi,
           barcode      = v_barcode,
           serial_number = COALESCE(v_sn, serial_number),
           updated_at   = now()
     WHERE id = v_ri_id
       AND request_id = p_request_id
       AND item_status NOT IN ('terkirim', 'ditolak');
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item tidak valid / sudah terkirim / ditolak';
    END IF;
    v_count := v_count + 1;
  END LOOP;

  -- 1b) Tandai item yang di-skip (stok kosong) sebagai pending_sebagian
  -- agar muncul di dashboard "Sisa Belum Terkirim".
  IF p_skip_ids IS NOT NULL AND array_length(p_skip_ids, 1) > 0 THEN
    UPDATE public.request_items
       SET item_status = 'pending_sebagian',
           updated_at  = now()
     WHERE request_id = p_request_id
       AND id = ANY(p_skip_ids)
       AND item_status NOT IN ('terkirim', 'ditolak', 'disetujui');
  END IF;

  UPDATE public.requests
     SET status = 'disetujui',
         updated_at = now()
   WHERE id = p_request_id
     AND status IN ('diajukan', 'disetujui_sebagian', 'diproses');

  -- 2) Kirim via jalur normal (multi-lokasi otomatis).
  v_txn := public.ship_request_items(p_request_id, NULL::uuid, p_lines, p_notes, false);
  RETURN v_txn;
END;
$$;

REVOKE ALL ON FUNCTION public.quick_ship_request(uuid, jsonb, text, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.quick_ship_request(uuid, jsonb, text, uuid[]) TO authenticated;
