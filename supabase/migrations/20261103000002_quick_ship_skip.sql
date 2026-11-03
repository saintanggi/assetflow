-- 20261103000002_quick_ship_skip.sql
-- Update quick_ship_request: terima daftar item yang TIDAK dikirim (stok kosong).
-- Item yang di-skip ditandai item_status = 'pending_sebagian' agar muncul
-- di dashboard/menu "Sisa Belum Terkirim".

DROP FUNCTION IF EXISTS public.quick_ship_request(uuid, jsonb, text);

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
       SET qty_approved = v_qty,
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
