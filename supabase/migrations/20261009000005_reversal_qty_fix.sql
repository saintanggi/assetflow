-- Migration 0005: izinkan qty negatif pada _apply_posted_effects KHUSUS untuk
-- transaksi koreksi (reversal_of IS NOT NULL). Tanpa ini, reverse_inventory_transaction
-- selalu gagal karena validasi "qty harus > 0" menolak qty yang dibalik.
-- Koreksi non-nol tetap wajib; kecukupan stok tetap dijaga oleh _change_balance.
CREATE OR REPLACE FUNCTION public._apply_posted_effects(p_transaction_id uuid)
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
    -- Item harus aktif; qty harus bulat bila satuan tidak desimal.
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
      IF it.qty = 0 THEN
        RAISE EXCEPTION 'Qty transfer tidak boleh 0';
      END IF;
      -- Koreksi (reversal_of terisi) memakai qty negatif yang dibalik.
      IF it.qty < 0 AND r.reversal_of IS NULL THEN
        RAISE EXCEPTION 'Qty transfer harus lebih dari 0';
      END IF;
      -- Kunci dalam urutan location_id yang konsisten.
      IF r.source_location_id < r.dest_location_id THEN
        PERFORM public._change_balance(it.item_id, r.source_location_id, -it.qty, p_transaction_id);
        PERFORM public._change_balance(it.item_id, r.dest_location_id,   it.qty, p_transaction_id);
      ELSE
        PERFORM public._change_balance(it.item_id, r.dest_location_id,   it.qty, p_transaction_id);
        PERFORM public._change_balance(it.item_id, r.source_location_id, -it.qty, p_transaction_id);
      END IF;
    ELSE
      IF r.type IN ('in', 'out', 'return') AND it.qty = 0 THEN
        RAISE EXCEPTION 'Qty tidak boleh 0 untuk transaksi tipe %', r.type;
      END IF;
      -- Koreksi (reversal_of terisi) memakai qty negatif yang dibalik.
      IF r.type IN ('in', 'out', 'return') AND it.qty < 0 AND r.reversal_of IS NULL THEN
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

      PERFORM public._change_balance(it.item_id, v_loc, v_delta, p_transaction_id);
    END IF;
  END LOOP;
END;
$$;
