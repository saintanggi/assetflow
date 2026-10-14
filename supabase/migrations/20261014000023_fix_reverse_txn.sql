-- 20261014000023 — Perbaiki reverse_inventory_transaction.
-- BUG: reversal dibuat dengan tipe SAMA ('out') tapi qty NEGATIF (-4),
-- padahal validasi _apply_posted_effects mewajibkan qty > 0 untuk
-- tipe in/out/return -> selalu gagal "Qty harus lebih dari 0".
-- FIX: balik tipe transaksi (out<->in, return->out, transfer swap lokasi)
-- sehingga qty tetap positif dan arah stok benar-benar kebalikan.

CREATE OR REPLACE FUNCTION public.reverse_inventory_transaction(
  p_transaction_id uuid,
  p_reason         text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  r        record;
  v_new_id uuid;
  v_doc    text;
  v_key    text;
  v_req    text;
  v_new_type   text;
  v_new_source uuid;
  v_new_dest   uuid;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Alasan koreksi wajib diisi';
  END IF;

  SELECT * INTO r
  FROM public.inventory_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaksi % tidak ditemukan', p_transaction_id;
  END IF;
  IF r.status <> 'posted' THEN
    RAISE EXCEPTION 'Hanya transaksi posted yang bisa dikoreksi (status saat ini: %)', r.status;
  END IF;

  -- Tentukan tipe & lokasi kebalikan (qty tetap positif).
  v_new_type := CASE r.type
    WHEN 'out'    THEN 'in'
    WHEN 'in'     THEN 'out'
    WHEN 'return' THEN 'out'
    ELSE r.type
  END;
  v_new_source := CASE
    WHEN r.type = 'out'              THEN NULL
    WHEN r.type IN ('in', 'return')   THEN r.dest_location_id
    WHEN r.type = 'transfer'          THEN r.dest_location_id
    ELSE r.source_location_id
  END;
  v_new_dest := CASE
    WHEN r.type = 'out'              THEN r.source_location_id
    WHEN r.type IN ('in', 'return')   THEN NULL
    WHEN r.type = 'transfer'          THEN r.source_location_id
    ELSE r.dest_location_id
  END;

  v_req := public._txn_required_permission(v_new_type);
  IF NOT public.has_permission(v_req) THEN
    RAISE EXCEPTION 'Izin ditolak: butuh permission % untuk mengoreksi transaksi %', v_req, r.type;
  END IF;

  v_key := 'rev-' || gen_random_uuid()::text;
  v_doc := public.next_doc_number('REV');

  INSERT INTO public.inventory_transactions (
    doc_number, type, status, transaction_date,
    source_location_id, dest_location_id,
    reference, notes, idempotency_key, created_by, posted_at,
    reversal_of, reversal_reason
  )
  VALUES (
    v_doc, v_new_type, 'posted', CURRENT_DATE,
    v_new_source, v_new_dest,
    'Koreksi atas ' || r.doc_number, btrim(p_reason),
    v_key, auth.uid(), now(),
    r.id, btrim(p_reason)
  )
  RETURNING id INTO v_new_id;

  -- Qty: untuk adjust/opname dinegasi (boleh negatif);
  -- untuk tipe lain qty tetap positif karena arah sudah dibalik via tipe.
  INSERT INTO public.inventory_transaction_items
    (transaction_id, item_id, qty, unit_price, notes)
  SELECT v_new_id, item_id,
         CASE WHEN r.type IN ('adjust', 'opname') THEN -qty ELSE qty END,
         unit_price, 'koreksi atas ' || r.doc_number
  FROM public.inventory_transaction_items
  WHERE transaction_id = r.id;

  PERFORM public._apply_posted_effects(v_new_id);

  UPDATE public.inventory_transactions
     SET status = 'reversed',
         reversed_at = now()
   WHERE id = r.id;

  RETURN v_doc;
END;
$$;
