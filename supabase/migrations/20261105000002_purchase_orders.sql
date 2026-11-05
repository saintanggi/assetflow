-- 20261105000002 — Modul Purchase Order (PO) ke Supplier.
--
-- purchase_orders: header PO (nomor PO-YYYY-XXXX, supplier, status).
-- purchase_order_items: baris PO (item, qty pesan, qty terima, harga).
-- Status: draft → ordered → received_partial → received | cancelled.
-- receive_purchase_order: terima barang (sebagian/penuh) — posting stok masuk
-- via _change_balance ke lokasi tujuan + update qty_received + status PO.
-- Idempotency: penerimaan dicatat di inventory_transactions dengan
-- reference 'PO/<po_number>'.

CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number     text        NOT NULL UNIQUE,
  supplier_id   uuid        NOT NULL REFERENCES public.suppliers(id),
  status        text        NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'ordered', 'received_partial', 'received', 'cancelled')),
  order_date    date        NOT NULL DEFAULT CURRENT_DATE,
  expected_date date,
  total_amount  numeric(15,2) NOT NULL DEFAULT 0,
  notes         text,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.purchase_order_items (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id         uuid        NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  item_id       uuid        NOT NULL REFERENCES public.inventory_items(id),
  qty_ordered   numeric(15,3) NOT NULL CHECK (qty_ordered > 0),
  qty_received  numeric(15,3) NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  unit_price    numeric(15,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (po_id, item_id)
);
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_purchase_orders_updated_at ON public.purchase_orders;
CREATE TRIGGER trg_purchase_orders_updated_at
  BEFORE UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Terima barang PO (sebagian atau penuh).
-- p_items: [{po_item_id, qty}] — qty harus > 0 dan tidak melebihi sisa.
CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_po_id       uuid,
  p_items       jsonb,
  p_location_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_po            record;
  v_line          jsonb;
  v_poi           record;
  v_qty           numeric(15,3);
  v_txn_id        uuid;
  v_doc_number    text;
  v_all_received  boolean := true;
  v_any_received  boolean := false;
BEGIN
  SELECT * INTO v_po FROM public.purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase Order tidak ditemukan';
  END IF;
  IF v_po.status = 'cancelled' THEN
    RAISE EXCEPTION 'Purchase Order sudah dibatalkan';
  END IF;
  IF v_po.status = 'received' THEN
    RAISE EXCEPTION 'Purchase Order sudah diterima penuh';
  END IF;
  IF p_location_id IS NULL THEN
    RAISE EXCEPTION 'Lokasi tujuan wajib diisi';
  END IF;

  -- Buat dokumen transaksi Barang Masuk untuk penerimaan ini.
  v_doc_number := public.next_doc_number('IN');
  INSERT INTO public.inventory_transactions
    (doc_number, type, transaction_date, dest_location_id, reference, notes, created_by)
  VALUES
    (v_doc_number, 'in', CURRENT_DATE, p_location_id,
     'PO/' || v_po.po_number, 'Penerimaan PO ' || v_po.po_number, auth.uid())
  RETURNING id INTO v_txn_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := (v_line->>'qty')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Qty terima harus lebih dari 0';
    END IF;
    SELECT * INTO v_poi
    FROM public.purchase_order_items
    WHERE id = (v_line->>'po_item_id')::uuid AND po_id = p_po_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Baris PO tidak ditemukan';
    END IF;
    IF v_poi.qty_received + v_qty > v_poi.qty_ordered THEN
      RAISE EXCEPTION 'Qty terima melebihi qty pesan untuk %', v_poi.item_id;
    END IF;

    PERFORM public._change_balance(v_poi.item_id, p_location_id, v_qty, v_txn_id, false);

    INSERT INTO public.inventory_transaction_items
      (transaction_id, item_id, qty, unit_price)
    VALUES (v_txn_id, v_poi.item_id, v_qty, v_poi.unit_price);

    UPDATE public.purchase_order_items
       SET qty_received = qty_received + v_qty
     WHERE id = v_poi.id;

    v_any_received := true;
  END LOOP;

  IF NOT v_any_received THEN
    RAISE EXCEPTION 'Tidak ada barang yang diterima';
  END IF;

  -- Update status PO: penuh atau sebagian.
  SELECT COALESCE(bool_and(qty_received >= qty_ordered), false)
    INTO v_all_received
    FROM public.purchase_order_items
   WHERE po_id = p_po_id;

  UPDATE public.purchase_orders
     SET status = CASE WHEN v_all_received THEN 'received' ELSE 'received_partial' END,
         updated_at = now()
   WHERE id = p_po_id;

  RETURN v_doc_number;
END;
$$;
REVOKE ALL ON FUNCTION public.receive_purchase_order(uuid, jsonb, uuid) FROM PUBLIC;
