-- 20261016000032_fix_ship_multilocation.sql
-- BUG: ship_request_items membuat SATU transaksi OUT dengan SATU source_location_id
-- untuk semua item, sehingga item ber-status_aset ASSET RETUR / UNREADY ikut
-- terpotong dari lokasi yang dipilih admin (umumnya STOK-BARU).
-- Contoh nyata: tiket A2610140956 (REQ-2026-000037) — 6 item diminta ASSET RETUR
-- tetapi seluruh 10 item tercatat ASSET BARU dan dipotong dari Stok Barang Baru.
--
-- PERBAIKAN: baris dikelompokkan per status_aset (dinormalisasi), lalu dibuat
-- SATU transaksi OUT per lokasi (STOK-BARU / STOK-RETUR / STOK-UNREADY).
-- p_location_id dipertahankan pada signature untuk kompatibilitas pemanggil,
-- tetapi lokasi kategori yang hilang akan menghasilkan error (tidak fallback).
-- Return: uuid transaksi pertama (kompatibel dengan pemanggil lama).

CREATE OR REPLACE FUNCTION public.ship_request_items(
  p_request_id     uuid,
  p_location_id    uuid,
  p_lines          jsonb,
  p_notes          text    DEFAULT NULL,
  p_allow_negative boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_req_status  text;
  v_req_number  text;
  v_req_date    date;
  v_branch_name text;
  v_txn_id      uuid;
  v_first_txn   uuid;
  v_line        jsonb;
  v_ri_id       uuid;
  v_qty         numeric;
  v_resi        text;
  v_item_id     uuid;
  v_approved    numeric;
  v_shipped     numeric;
  v_item_status text;
  v_status_aset text;
  v_norm_aset   text;
  v_loc_baru    uuid;
  v_loc_retur   uuid;
  v_loc_unready uuid;
  v_group_loc   uuid;
BEGIN
  IF NOT (public.has_permission('requests.review') OR public.has_permission('requests.approve')) THEN
    RAISE EXCEPTION 'Tidak punya izin mengirim permintaan';
  END IF;

  SELECT status, request_number, request_date, branch_name
    INTO v_req_status, v_req_number, v_req_date, v_branch_name
    FROM public.requests
   WHERE id = p_request_id
   FOR UPDATE;

  IF v_req_status IS NULL THEN
    RAISE EXCEPTION 'Permintaan tidak ditemukan';
  END IF;
  IF v_req_status NOT IN ('disetujui', 'disetujui_sebagian', 'diproses', 'selesai') THEN
    RAISE EXCEPTION 'Permintaan belum disetujui (status: %)', v_req_status;
  END IF;

  -- Lokasi stok per jenis (kode unik global); kategori yang hilang harus error.
  SELECT id INTO v_loc_baru    FROM public.locations WHERE code = 'STOK-BARU'    AND is_active LIMIT 1;
  SELECT id INTO v_loc_retur   FROM public.locations WHERE code = 'STOK-RETUR'   AND is_active LIMIT 1;
  SELECT id INTO v_loc_unready FROM public.locations WHERE code = 'STOK-UNREADY' AND is_active LIMIT 1;

  CREATE TEMP TABLE tmp_ship_lines (
    item_id     uuid,
    qty         numeric,
    resi        text,
    status_aset text,
    location_id uuid
  ) ON COMMIT DROP;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_ri_id := (v_line->>'request_item_id')::uuid;
    v_qty   := (v_line->>'qty')::numeric;
    v_resi  := NULLIF(btrim(COALESCE(v_line->>'resi', '')), '');

    SELECT item_id, qty_approved, qty_shipped, item_status, status_aset
      INTO v_item_id, v_approved, v_shipped, v_item_status, v_status_aset
      FROM public.request_items
     WHERE id = v_ri_id AND request_id = p_request_id
     FOR UPDATE;

    IF v_item_id IS NULL THEN
      RAISE EXCEPTION 'Item permintaan tidak valid';
    END IF;
    IF v_approved IS NULL THEN
      RAISE EXCEPTION 'Item belum di-approve (id %)', v_ri_id;
    END IF;
    IF v_item_status NOT IN ('disetujui', 'diproses', 'siap', 'pending_sebagian') THEN
      RAISE EXCEPTION 'Item belum siap dikirim (status: %)', v_item_status;
    END IF;
    IF v_qty <= 0 OR v_qty > (v_approved - v_shipped) THEN
      RAISE EXCEPTION 'Qty kirim % melebihi sisa %', v_qty, (v_approved - v_shipped);
    END IF;

    v_norm_aset := CASE
      WHEN upper(COALESCE(v_status_aset, '')) LIKE '%UNREADY%' THEN 'UNREADY'
      WHEN upper(COALESCE(v_status_aset, '')) LIKE '%RETUR%'   THEN 'ASSET RETUR'
      ELSE 'ASSET BARU'
    END;

    -- Lokasi potong mengikuti jenis stok item, bukan pilihan tunggal admin.
    v_group_loc := CASE v_norm_aset
      WHEN 'ASSET RETUR' THEN v_loc_retur
      WHEN 'UNREADY'     THEN v_loc_unready
      ELSE v_loc_baru
    END;

    IF v_group_loc IS NULL THEN
      RAISE EXCEPTION 'Lokasi stok untuk jenis aset % belum tersedia', v_norm_aset;
    END IF;

    UPDATE public.request_items
       SET qty_shipped = qty_shipped + v_qty,
           resi        = COALESCE(v_resi, resi),
           item_status = CASE
             WHEN qty_shipped + v_qty >= qty_approved THEN 'terkirim'
             ELSE 'pending_sebagian'
           END,
           updated_at  = now()
     WHERE id = v_ri_id;

    INSERT INTO tmp_ship_lines VALUES (v_item_id, v_qty, v_resi, v_norm_aset, v_group_loc);
  END LOOP;

  -- Satu transaksi OUT per lokasi: tiap jenis stok terpotong dari lokasi yang benar.
  FOR v_group_loc IN SELECT DISTINCT location_id FROM tmp_ship_lines LOOP
    INSERT INTO public.inventory_transactions (
      type, status, transaction_date, source_location_id, notes, reference, created_by, posted_at
    )
    VALUES (
      'out', 'posted', COALESCE(v_req_date, CURRENT_DATE), v_group_loc, p_notes,
      'REQ-KIRIM/' || v_req_number, auth.uid(), now()
    )
    RETURNING id INTO v_txn_id;

    IF v_first_txn IS NULL THEN
      v_first_txn := v_txn_id;
    END IF;

    -- Agregasi per item_id dalam satu transaksi (hindari pelanggaran uq_txn_item).
    INSERT INTO public.inventory_transaction_items
      (transaction_id, item_id, qty, notes, resi, gerai, status_aset)
    SELECT
      v_txn_id,
      item_id,
      SUM(qty),
      'Kirim permintaan ' || v_req_number,
      NULLIF(STRING_AGG(DISTINCT resi, ', ' ORDER BY resi), ''),
      v_branch_name,
      MAX(status_aset)
    FROM tmp_ship_lines
    WHERE location_id = v_group_loc
    GROUP BY item_id;

    PERFORM public._apply_posted_effects(v_txn_id, p_allow_negative);
  END LOOP;

  DROP TABLE tmp_ship_lines;

  -- Update status header request secara akurat:
  -- 'selesai' hanya jika seluruh baris item sudah 'terkirim' atau 'ditolak'.
  UPDATE public.requests
     SET status = CASE
           WHEN NOT EXISTS (
             SELECT 1 FROM public.request_items
              WHERE request_id = p_request_id
                AND item_status NOT IN ('terkirim', 'ditolak')
           ) THEN 'selesai'
           WHEN EXISTS (
             SELECT 1 FROM public.request_items
              WHERE request_id = p_request_id
                AND item_status IN ('pending_sebagian', 'menunggu_stok')
           ) THEN 'disetujui_sebagian'
           ELSE 'diproses'
         END,
         updated_at = now()
   WHERE id = p_request_id;

  RETURN v_first_txn;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ship_request_items(uuid, uuid, jsonb, text, boolean) TO authenticated;
