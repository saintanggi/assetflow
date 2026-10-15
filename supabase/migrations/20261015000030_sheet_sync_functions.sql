-- =============================================================
-- Bagian 2 — fungsi khusus sinkronisasi Google Sheet
-- =============================================================
-- Edge Function `sync-sheets` berjalan dengan service_role (auth.uid() = NULL),
-- sehingga RPC ship_request_items() yang memakai has_permission() tidak bisa
-- dipakai. Fungsi ini isinya identik dengan ship_request_items versi terakhir
-- (20261015000028), hanya pengecekan izinnya ditambah is_service_role().

CREATE OR REPLACE FUNCTION public.is_service_role()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), auth.role()) = 'service_role'
$$;

GRANT EXECUTE ON FUNCTION public.is_service_role() TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.sync_ship_request_items(
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
BEGIN
  -- Dipakai Edge Function sinkronisasi (service_role) dan tetap aman untuk
  -- pengguna biasa karena hak aksesnya sama seperti ship_request_items.
  IF NOT (
    public.is_super_admin()
    OR public.is_service_role()
    OR public.has_permission('requests.review')
    OR public.has_permission('requests.approve')
  ) THEN
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

  INSERT INTO public.inventory_transactions (
    type, status, transaction_date, source_location_id, notes, reference, created_by, posted_at
  )
  VALUES (
    'out', 'posted', COALESCE(v_req_date, CURRENT_DATE), p_location_id, p_notes,
    'REQ-KIRIM/' || v_req_number, auth.uid(), now()
  )
  RETURNING id INTO v_txn_id;

  CREATE TEMP TABLE tmp_ship_lines (
    item_id     uuid,
    qty         numeric,
    resi        text,
    status_aset text
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

    UPDATE public.request_items
       SET qty_shipped = qty_shipped + v_qty,
           resi        = COALESCE(v_resi, resi),
           item_status = CASE
             WHEN qty_shipped + v_qty >= qty_approved THEN 'terkirim'
             ELSE 'pending_sebagian'
           END,
           updated_at  = now()
     WHERE id = v_ri_id;

    INSERT INTO tmp_ship_lines VALUES (v_item_id, v_qty, v_resi, v_norm_aset);
  END LOOP;

  -- Agregasi per item_id (hindari pelanggaran uq_txn_item).
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
  GROUP BY item_id;

  DROP TABLE tmp_ship_lines;

  PERFORM public._apply_posted_effects(v_txn_id, p_allow_negative);

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

  RETURN v_txn_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.sync_ship_request_items(uuid, uuid, jsonb, text, boolean)
  TO service_role;
REVOKE ALL ON FUNCTION public.sync_ship_request_items(uuid, uuid, jsonb, text, boolean) FROM PUBLIC, anon, authenticated;
