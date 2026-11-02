-- 20261016000034_quick_ship_request.sql
-- KIRIM CEPAT 1 PINTU (khusus super_admin).
-- Latar: operasional dijalankan 1 user (super admin) sehingga alur 3 langkah
-- (review admin gudang → proses helper → kirim) terlalu bertele-tele.
-- Fungsi ini menggabungkan semuanya dalam 1 panggilan:
--   1. Setujui item (qty_approved = qty kirim, item_status = 'disetujui')
--   2. Delegasi ke ship_request_items yang sudah multi-lokasi per status_aset
--      (migrasi 20261016000032) → tiap jenis stok dipotong dari lokasi yang benar.
-- p_location_id = NULL: lokasi ditentukan otomatis dari status_aset tiap item.

CREATE OR REPLACE FUNCTION public.quick_ship_request(
  p_request_id uuid,
  p_lines      jsonb,
  p_notes      text DEFAULT NULL
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
  v_txn   uuid;
  v_count int := 0;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Kirim cepat hanya untuk super admin';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Tidak ada item untuk dikirim';
  END IF;

  -- 1) Approve langsung semua baris yang dikirim.
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_ri_id := (v_line->>'request_item_id')::uuid;
    v_qty   := (v_line->>'qty')::numeric;
    v_resi  := NULLIF(btrim(COALESCE(v_line->>'resi', '')), '');

    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Qty kirim harus lebih dari 0';
    END IF;

    UPDATE public.request_items
       SET qty_approved = v_qty,
           item_status  = 'disetujui',
           resi         = COALESCE(v_resi, resi),
           updated_at   = now()
     WHERE id = v_ri_id
       AND request_id = p_request_id
       AND item_status NOT IN ('terkirim', 'ditolak');
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item tidak valid / sudah terkirim / ditolak';
    END IF;
    v_count := v_count + 1;
  END LOOP;

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

REVOKE ALL ON FUNCTION public.quick_ship_request(uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.quick_ship_request(uuid, jsonb, text) TO authenticated;
