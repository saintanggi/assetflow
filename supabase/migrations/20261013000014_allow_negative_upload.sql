-- 20261013000014 — Izinkan stok minus untuk upload massal.
-- Tambah parameter p_allow_negative ke _change_balance, _apply_posted_effects, ship_request_items.

CREATE OR REPLACE FUNCTION public._change_balance(
  p_item_id        uuid,
  p_location_id    uuid,
  p_delta          numeric,
  p_transaction_id uuid,
  p_allow_negative boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_qty numeric(15,3);
BEGIN
  IF p_location_id IS NULL THEN
    RAISE EXCEPTION 'Lokasi wajib diisi untuk perubahan stok';
  END IF;
  IF p_delta = 0 THEN
    RAISE EXCEPTION 'Perubahan stok tidak boleh nol';
  END IF;

  INSERT INTO public.inventory_balances (item_id, location_id, qty)
  VALUES (p_item_id, p_location_id, 0)
  ON CONFLICT DO NOTHING;

  SELECT qty INTO v_qty
  FROM public.inventory_balances
  WHERE item_id = p_item_id AND location_id = p_location_id
  FOR UPDATE;

  IF NOT p_allow_negative AND v_qty + p_delta < 0 THEN
    RAISE EXCEPTION
      'Stok tidak mencukupi (item %, lokasi %): tersedia %, perubahan %',
      p_item_id, p_location_id, v_qty, p_delta;
  END IF;

  UPDATE public.inventory_balances
     SET qty = v_qty + p_delta
   WHERE item_id = p_item_id AND location_id = p_location_id;

  INSERT INTO public.inventory_ledger
    (transaction_id, item_id, location_id, qty_change, qty_after)
  VALUES (p_transaction_id, p_item_id, p_location_id, p_delta, v_qty + p_delta);
END;
$$;
REVOKE ALL ON FUNCTION public._change_balance(uuid, uuid, numeric, uuid, boolean) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public._apply_posted_effects(
  p_transaction_id uuid,
  p_allow_negative boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  r        record;
  it       record;
  v_loc    uuid;
  v_delta  numeric(15,3);
  v_allow  boolean;
BEGIN
  SELECT * INTO r
  FROM public.inventory_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaksi % tidak ditemukan', p_transaction_id;
  END IF;
  IF r.status <> 'posted' THEN
    RAISE EXCEPTION 'Efek stok hanya boleh diterapkan untuk transaksi posted';
  END IF;

  FOR it IN
    SELECT *
    FROM public.inventory_transaction_items
    WHERE transaction_id = p_transaction_id
    ORDER BY item_id
  LOOP
    SELECT u.allow_decimal INTO v_allow
    FROM public.inventory_items i
    JOIN public.units u ON u.id = i.unit_id
    WHERE i.id = it.item_id AND i.is_active;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item % tidak ditemukan atau tidak aktif', it.item_id;
    END IF;
    IF NOT COALESCE(v_allow, true) AND it.qty <> trunc(it.qty) THEN
      RAISE EXCEPTION 'Qty item % harus bilangan bulat sesuai satuannya', it.item_id;
    END IF;

    IF r.type = 'transfer' THEN
      IF it.qty <= 0 THEN
        RAISE EXCEPTION 'Qty transfer harus lebih dari 0';
      END IF;
      IF r.source_location_id < r.dest_location_id THEN
        PERFORM public._change_balance(it.item_id, r.source_location_id, -it.qty, p_transaction_id, p_allow_negative);
        PERFORM public._change_balance(it.item_id, r.dest_location_id,   it.qty, p_transaction_id, p_allow_negative);
      ELSE
        PERFORM public._change_balance(it.item_id, r.dest_location_id,   it.qty, p_transaction_id, p_allow_negative);
        PERFORM public._change_balance(it.item_id, r.source_location_id, -it.qty, p_transaction_id, p_allow_negative);
      END IF;
    ELSE
      IF r.type IN ('in', 'out', 'return') AND it.qty <= 0 THEN
        RAISE EXCEPTION 'Qty harus lebih dari 0 untuk transaksi tipe %', r.type;
      END IF;
      IF r.type IN ('adjust', 'opname') AND it.qty = 0 THEN
        RAISE EXCEPTION 'Qty tidak boleh 0 untuk transaksi tipe %', r.type;
      END IF;

      v_loc := CASE
        WHEN r.type IN ('in', 'return') THEN r.dest_location_id
        WHEN r.type = 'out'            THEN r.source_location_id
        ELSE COALESCE(r.source_location_id, r.dest_location_id)
      END;
      v_delta := CASE
        WHEN r.type = 'out' THEN -it.qty
        ELSE it.qty
      END;

      PERFORM public._change_balance(it.item_id, v_loc, v_delta, p_transaction_id, p_allow_negative);
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public._apply_posted_effects(uuid, boolean) FROM PUBLIC;

-- ship_request_items: tambah p_allow_negative (default false, aman untuk alur normal).
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
BEGIN
  IF NOT (public.has_permission('requests.review')) THEN
    RAISE EXCEPTION 'Tidak punya izin mengirim permintaan';
  END IF;

  SELECT status INTO v_req_status FROM public.requests WHERE id = p_request_id;
  IF v_req_status IS NULL THEN RAISE EXCEPTION 'Permintaan tidak ditemukan'; END IF;
  IF v_req_status NOT IN ('disetujui','disetujui_sebagian','diproses') THEN
    RAISE EXCEPTION 'Permintaan belum disetujui (status: %)', v_req_status;
  END IF;

  INSERT INTO public.inventory_transactions
    (type, status, source_location_id, notes, reference, created_by)
  VALUES
    ('out', 'posted', p_location_id, p_notes,
     (SELECT 'REQ-KIRIM/' || request_number FROM public.requests WHERE id = p_request_id),
     auth.uid())
  RETURNING id INTO v_txn_id;

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

    INSERT INTO public.inventory_transaction_items
      (transaction_id, item_id, qty, notes, resi)
    VALUES
      (v_txn_id, v_item_id, v_qty,
       'Kirim permintaan ' || (SELECT request_number FROM public.requests WHERE id = p_request_id),
       v_resi);

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
