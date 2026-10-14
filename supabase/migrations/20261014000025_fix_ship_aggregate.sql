-- 20261014000025 — Perbaiki ship_request_items: agregasi per item_id.
-- BUG: setelah fitur split, 1 item bisa jadi beberapa baris request_items.
-- Saat dikirim bareng, RPC insert 1 baris transaksi per baris request
-- -> duplicate key violates uq_txn_item (transaction_id, item_id).
-- FIX: kumpulkan baris ke temp table, insert transaksi diagregasi
-- per item_id (qty dijumlah, resi digabung).

CREATE OR REPLACE FUNCTION public.ship_request_items(
  p_request_id uuid,
  p_location_id uuid,
  p_lines jsonb,
  p_notes text DEFAULT NULL,
  p_allow_negative boolean DEFAULT false
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_req_status text;
  v_txn_id uuid;
  v_line jsonb;
  v_ri_id uuid; v_qty numeric; v_resi text;
  v_item_id uuid; v_item_name text; v_approved numeric; v_shipped numeric;
  v_item_status text;
  v_req_number text;
BEGIN
  IF NOT (public.has_permission('requests.review')) THEN
    RAISE EXCEPTION 'Tidak punya izin mengirim permintaan';
  END IF;

  SELECT status INTO v_req_status FROM public.requests WHERE id = p_request_id;
  IF v_req_status IS NULL THEN RAISE EXCEPTION 'Permintaan tidak ditemukan'; END IF;
  IF v_req_status NOT IN ('disetujui','disetujui_sebagian','diproses') THEN
    RAISE EXCEPTION 'Permintaan belum disetujui (status: %)', v_req_status;
  END IF;

  SELECT request_number INTO v_req_number FROM public.requests WHERE id = p_request_id;

  INSERT INTO public.inventory_transactions
    (type, status, source_location_id, notes, reference, created_by)
  VALUES
    ('out', 'posted', p_location_id, p_notes,
     'REQ-KIRIM/' || v_req_number,
     auth.uid())
  RETURNING id INTO v_txn_id;

  -- Tampung baris untuk agregasi per item_id.
  CREATE TEMP TABLE tmp_ship_lines (item_id uuid, qty numeric, resi text)
    ON COMMIT DROP;

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

    -- Update per baris request_item tetap individual (status per satuan).
    UPDATE public.request_items
    SET qty_shipped = qty_shipped + v_qty,
        resi = COALESCE(v_resi, resi),
        item_status = CASE
          WHEN qty_shipped + v_qty >= qty_approved THEN 'terkirim'
          ELSE 'pending_sebagian'
        END,
        updated_at = now()
    WHERE id = v_ri_id;

    INSERT INTO tmp_ship_lines VALUES (v_item_id, v_qty, v_resi);
  END LOOP;

  -- Insert baris transaksi diagregasi per item_id (hindari uq_txn_item).
  INSERT INTO public.inventory_transaction_items
    (transaction_id, item_id, qty, notes, resi)
  SELECT v_txn_id, item_id, SUM(qty),
         'Kirim permintaan ' || v_req_number,
         NULLIF(STRING_AGG(DISTINCT resi, ', ' ORDER BY resi), '')
  FROM tmp_ship_lines
  GROUP BY item_id;

  DROP TABLE tmp_ship_lines;

  PERFORM public._apply_posted_effects(v_txn_id, p_allow_negative);

  UPDATE public.requests
     SET status = CASE
           WHEN EXISTS (SELECT 1 FROM public.request_items
                         WHERE request_id = p_request_id
                           AND item_status = 'pending_sebagian') THEN 'disetujui_sebagian'
           ELSE 'selesai' END,
         updated_at = now()
   WHERE id = p_request_id;

  RETURN v_txn_id;
END;
$$;
