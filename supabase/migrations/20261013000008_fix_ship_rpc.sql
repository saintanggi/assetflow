-- 20261013000008 — Perbaiki RPC ship_request_items: kolom requested_by -> created_by
-- (tabel inventory_transactions tidak punya kolom requested_by).
CREATE OR REPLACE FUNCTION public.ship_request_items(
  p_request_id uuid,
  p_location_id uuid,
  p_lines jsonb,
  p_notes text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_req_status text;
  v_txn_id uuid;
  v_line jsonb;
  v_ri_id uuid; v_qty numeric; v_resi text;
  v_item_id uuid; v_item_name text; v_approved numeric; v_shipped numeric;
  v_item_status text;
BEGIN
  IF NOT (public.has_permission('requests.review')) THEN
    RAISE EXCEPTION 'Tidak punya izin mengirim permintaan';
  END IF;

  SELECT status INTO v_req_status FROM public.requests WHERE id = p_request_id;
  IF v_req_status IS NULL THEN RAISE EXCEPTION 'Permintaan tidak ditemukan'; END IF;
  IF v_req_status NOT IN ('disetujui','disetujui_sebagian','diproses') THEN
    RAISE EXCEPTION 'Permintaan belum disetujui (status: %)', v_req_status;
  END IF;

  -- Buat header transaksi OUT.
  INSERT INTO public.inventory_transactions
    (type, status, source_location_id, notes, reference, created_by)
  VALUES
    ('out', 'posted', p_location_id, p_notes,
     (SELECT 'REQ-KIRIM/' || request_number FROM public.requests WHERE id = p_request_id),
     auth.uid())
  RETURNING id INTO v_txn_id;

  -- Proses tiap baris.
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_ri_id := (v_line->>'request_item_id')::uuid;
    v_qty   := (v_line->>'qty')::numeric;
    v_resi  := NULLIF(v_line->>'resi','');

    SELECT item_id, qty_approved, qty_shipped, item_status
      INTO v_item_id, v_approved, v_shipped, v_item_status
      FROM public.request_items WHERE id = v_ri_id AND request_id = p_request_id;

    IF v_item_id IS NULL THEN RAISE EXCEPTION 'Item permintaan tidak valid'; END IF;
    IF v_approved IS NULL THEN RAISE EXCEPTION 'Item belum di-approve (id %)', v_ri_id; END IF;
    IF v_item_status NOT IN ('disetujui','siap','pending_sebagian') THEN
      RAISE EXCEPTION 'Item belum siap dikirim (status: %)', v_item_status;
    END IF;
    IF v_qty <= 0 OR v_qty > (v_approved - v_shipped) THEN
      RAISE EXCEPTION 'Qty kirim % melebihi sisa %', v_qty, (v_approved - v_shipped);
    END IF;

    SELECT name INTO v_item_name FROM public.inventory_items WHERE id = v_item_id;

    -- Baris transaksi OUT (memakai efek posted -> stok berkurang).
    INSERT INTO public.inventory_transaction_items
      (transaction_id, item_id, qty, notes, resi)
    VALUES
      (v_txn_id, v_item_id, v_qty,
       'Kirim permintaan ' || (SELECT request_number FROM public.requests WHERE id = p_request_id),
       v_resi);

    -- Update item permintaan.
    UPDATE public.request_items
    SET qty_shipped = qty_shipped + v_qty,
        resi = COALESCE(v_resi, resi),
        item_status = CASE
          WHEN qty_shipped + v_qty >= qty_approved THEN 'terkirim'
          ELSE 'pending_sebagian'
        END,
        updated_at = now()
    WHERE id = v_ri_id;
  END LOOP;

  -- Terapkan efek stok.
  PERFORM public._apply_posted_effects(v_txn_id);

  -- Update status header request.
  UPDATE public.requests SET status = CASE
      WHEN NOT EXISTS (SELECT 1 FROM public.request_items
                       WHERE request_id = p_request_id
                         AND item_status NOT IN ('terkirim','ditolak')) THEN 'selesai'
      WHEN EXISTS (SELECT 1 FROM public.request_items
                   WHERE request_id = p_request_id AND item_status = 'pending_sebagian') THEN 'disetujui_sebagian'
      ELSE 'diproses'
    END,
    updated_at = now()
  WHERE id = p_request_id;

  RETURN v_txn_id;
END $$;
