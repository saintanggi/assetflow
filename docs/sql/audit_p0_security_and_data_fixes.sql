-- =============================================================================
-- 20261126000001 — Perbaikan Audit Menyeluruh (P0 Integritas Data, Keamanan & Skala)
-- =============================================================================
-- Prinsip WAJIB:
--   * 100% NON-BREAKING: tidak menghapus / mengubah data historis stok,
--     ledger, permintaan, aset, maupun akun yang sudah berjalan.
--   * IDEMPOTEN: aman dijalankan berulang (CREATE OR REPLACE / IF NOT EXISTS).
--   * KOMPATIBEL KE BELAKANG: parameter baru pada RPC memakai DEFAULT NULL
--     sehingga aplikasi lama tetap jalan sebelum deploy frontend baru.
--
-- Cakupan perbaikan:
--   1. public.today_wib() — tanggal bisnis WIB (Asia/Jakarta), ganti UTC CURRENT_DATE.
--   2. receive_purchase_order() — GRANT EXECUTE TO authenticated, cek izin
--      inventory.receive, tolak PO draft, tulis status='posted' + posted_at,
--      idempotency key, validasi allow_decimal, tanggal WIB + perbaikan aman
--      transaksi PO lama yang telanjur berstatus 'draft'.
--   3. create_purchase_order() — buat header + item PO secara atomik dengan
--      penomoran anti-race next_doc_number('PO') + created_by = auth.uid().
--   4. cancel_pending_request_item() — JANGAN hapus baris bila qty_shipped > 0
--      (cukup tutup sisa yg belum dikirim agar stok & riwayat kirim tidak rusak),
--      serta hitung ulang status header requests secara akurat.
--   5. admin_move_stock_between_items() & admin_change_request_item() —
--      perbaiki bug tabrakan idempotency_key antar tiket berbeda dengan
--      menyertakan p_request_item_id + tanggal WIB.
--   6. void_inventory_transaction() — tambah row lock FOR UPDATE, blokir hapus
--      transaksi REQ-KIRIM/% / HAPUS-ITEM/% / PO/%, tolak bila masih punya
--      child reversal, dan simpan snapshot penuh item + ledger ke audit_logs.
--   7. split_request_item() — pecah 1 baris permintaan (qty N) menjadi N baris
--      @1 secara atomik di database (tidak mungkin kehilangan qty di tengah jalan).
--   8. finalize_stock_count() — pakai today_wib() & jangan buat transaksi OPN
--      kosong bila seluruh item selisihnya 0.
--   9. reverse_inventory_transaction(), admin_correct_txn_item(),
--      admin_delete_request_item() — pakai today_wib().
--  10. Storage bucket surat-jalan — tambah izin inventory.receive & inventory.issue
--      pada policy write, dan batasi listing SELECT ke authenticated staff
--      (gambar lama tetap tampil, listing anonim ditutup).
--  11. View v_sheet_sync_recent — aktifkan security_invoker = true (tutup bypass RLS).
--  12. Guard trigger Maker-Checker pada request_items, requests, purchase_orders,
--      dan purchase_order_items (cegah manipulasi langsung lewat REST API).
--  13. Pasang trigger log_audit() pada tabel operasional penting lainnya.
--  14. RPC agregasi server-side (bebas limit 1.000 baris PostgREST):
--      - get_nav_queue_counts() (antrean + stok menipis berbasis *-BARU)
--      - get_dead_stock(p_days) (berbasis transaction_date & transaksi keluar 'out')
--      - try_lock_sheet_sync() / unlock_sheet_sync() (anti double-run cron)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Helper tanggal bisnis WIB (Asia/Jakarta)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.today_wib()
RETURNS date
LANGUAGE sql
STABLE
AS $$
  SELECT (now() AT TIME ZONE 'Asia/Jakarta')::date;
$$;
GRANT EXECUTE ON FUNCTION public.today_wib() TO authenticated, anon;

-- -----------------------------------------------------------------------------
-- 2. Perbaikan receive_purchase_order (P0)
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.receive_purchase_order(uuid, jsonb, uuid);
DROP FUNCTION IF EXISTS public.receive_purchase_order(uuid, jsonb, uuid, text, date);

CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_po_id           uuid,
  p_items           jsonb,
  p_location_id     uuid,
  p_idempotency_key text DEFAULT NULL,
  p_receive_date    date DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_po           record;
  v_line         jsonb;
  v_poi          record;
  v_qty          numeric(15,3);
  v_allow_dec    boolean;
  v_txn_id       uuid;
  v_doc_number   text;
  v_existing_doc text;
  v_key          text;
  v_all_received boolean := true;
  v_any_received boolean := false;
BEGIN
  IF NOT (public.has_permission('inventory.receive') OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Izin ditolak: butuh permission inventory.receive untuk menerima barang PO';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Daftar barang yang diterima tidak boleh kosong';
  END IF;
  IF p_location_id IS NULL THEN
    RAISE EXCEPTION 'Lokasi tujuan wajib diisi';
  END IF;

  -- Idempotency: cegah penerimaan ganda saat klik berulang / jaringan lambat.
  v_key := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  IF v_key IS NOT NULL THEN
    SELECT doc_number INTO v_existing_doc
      FROM public.inventory_transactions
     WHERE idempotency_key = v_key;
    IF FOUND THEN
      RETURN v_existing_doc;
    END IF;
  ELSE
    v_key := 'po-rcv-' || gen_random_uuid()::text;
  END IF;

  SELECT * INTO v_po FROM public.purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase Order tidak ditemukan';
  END IF;
  IF v_po.status = 'cancelled' THEN
    RAISE EXCEPTION 'Purchase Order sudah dibatalkan';
  END IF;
  IF v_po.status = 'draft' THEN
    RAISE EXCEPTION 'Purchase Order masih berstatus Draft — ubah ke Dipesan sebelum menerima barang';
  END IF;
  IF v_po.status = 'received' THEN
    RAISE EXCEPTION 'Purchase Order sudah diterima penuh';
  END IF;

  -- Tandai konteks internal RPC untuk guard trigger PO.
  PERFORM set_config('app.in_po_receive', '1', true);

  v_doc_number := public.next_doc_number('IN');
  INSERT INTO public.inventory_transactions (
    doc_number, type, status, transaction_date,
    dest_location_id, reference, notes, idempotency_key,
    created_by, posted_at
  )
  VALUES (
    v_doc_number, 'in', 'posted', COALESCE(p_receive_date, public.today_wib()),
    p_location_id, 'PO/' || v_po.po_number, 'Penerimaan PO ' || v_po.po_number, v_key,
    auth.uid(), now()
  )
  RETURNING id INTO v_txn_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := NULLIF(v_line->>'qty', '')::numeric;
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

    SELECT u.allow_decimal INTO v_allow_dec
      FROM public.inventory_items i
      JOIN public.units u ON u.id = i.unit_id
     WHERE i.id = v_poi.item_id;
    IF NOT COALESCE(v_allow_dec, true) AND v_qty <> trunc(v_qty) THEN
      RAISE EXCEPTION 'Qty terima harus bilangan bulat sesuai satuan barang';
    END IF;

    IF v_poi.qty_received + v_qty > v_poi.qty_ordered THEN
      RAISE EXCEPTION 'Qty terima melebihi sisa pesanan PO';
    END IF;

    PERFORM public._change_balance(v_poi.item_id, p_location_id, v_qty, v_txn_id, false);

    INSERT INTO public.inventory_transaction_items
      (transaction_id, item_id, qty, unit_price, notes)
    VALUES (
      v_txn_id, v_poi.item_id, v_qty, v_poi.unit_price,
      'Penerimaan PO ' || v_po.po_number
    );

    UPDATE public.purchase_order_items
       SET qty_received = qty_received + v_qty
     WHERE id = v_poi.id;

    v_any_received := true;
  END LOOP;

  IF NOT v_any_received THEN
    RAISE EXCEPTION 'Tidak ada barang yang diterima';
  END IF;

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

REVOKE ALL ON FUNCTION public.receive_purchase_order(uuid, jsonb, uuid, text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order(uuid, jsonb, uuid, text, date) TO authenticated;

-- Perbaikan aman (non-destruktif) untuk transaksi penerimaan PO lama yang sempat
-- tersimpan dengan status='draft' padahal ledger & saldo sudah terposting.
UPDATE public.inventory_transactions t
   SET status = 'posted',
       posted_at = COALESCE(t.posted_at, t.created_at),
       updated_at = now()
 WHERE t.status = 'draft'
   AND t.reference LIKE 'PO/%'
   AND EXISTS (
     SELECT 1 FROM public.inventory_ledger l WHERE l.transaction_id = t.id
   );

-- -----------------------------------------------------------------------------
-- 3. RPC atomik: create_purchase_order (anti-race PO number + anti orphan PO)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_purchase_order(
  p_supplier_id   uuid,
  p_status        text,
  p_order_date    date,
  p_expected_date date,
  p_notes         text,
  p_items         jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_po_id     uuid;
  v_po_number text;
  v_total     numeric(15,2) := 0;
  v_line      jsonb;
  v_item_id   uuid;
  v_qty       numeric(15,3);
  v_price     numeric(15,2);
BEGIN
  IF NOT (public.has_permission('inventory.receive') OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Izin ditolak: butuh permission inventory.receive untuk membuat PO';
  END IF;
  IF p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'Supplier wajib dipilih';
  END IF;
  IF p_status NOT IN ('draft', 'ordered') THEN
    RAISE EXCEPTION 'Status awal PO hanya boleh draft atau ordered';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Minimal satu barang harus ditambahkan ke PO';
  END IF;

  v_po_number := public.next_doc_number('PO');

  INSERT INTO public.purchase_orders (
    po_number, supplier_id, status, order_date, expected_date,
    total_amount, notes, created_by
  )
  VALUES (
    v_po_number, p_supplier_id, p_status, COALESCE(p_order_date, public.today_wib()),
    p_expected_date, 0, NULLIF(btrim(COALESCE(p_notes, '')), ''), auth.uid()
  )
  RETURNING id INTO v_po_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id := NULLIF(v_line->>'item_id', '')::uuid;
    v_qty     := NULLIF(v_line->>'qty_ordered', '')::numeric;
    v_price   := COALESCE(NULLIF(v_line->>'unit_price', '')::numeric, 0);

    IF v_item_id IS NULL THEN
      RAISE EXCEPTION 'Barang pada baris PO wajib dipilih';
    END IF;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Qty pesan PO harus lebih dari 0';
    END IF;
    IF v_price < 0 THEN
      RAISE EXCEPTION 'Harga satuan PO tidak boleh negatif';
    END IF;

    INSERT INTO public.purchase_order_items (po_id, item_id, qty_ordered, unit_price)
    VALUES (v_po_id, v_item_id, v_qty, v_price);

    v_total := v_total + ROUND(v_qty * v_price, 2);
  END LOOP;

  UPDATE public.purchase_orders
     SET total_amount = v_total
   WHERE id = v_po_id;

  RETURN jsonb_build_object(
    'id', v_po_id,
    'po_number', v_po_number,
    'total_amount', v_total
  );
END;
$$;
REVOKE ALL ON FUNCTION public.create_purchase_order(uuid, text, date, date, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_purchase_order(uuid, text, date, date, text, jsonb) TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. Perbaikan cancel_pending_request_item (P0: lindungi qty_shipped > 0)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_pending_request_item(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_item            record;
  v_req             record;
  v_remaining       int;
  v_request_deleted boolean := false;
  v_closed_partial  boolean := false;
  v_new_status      text;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Hanya super admin yang bisa menghapus sisa belum terkirim';
  END IF;

  SELECT * INTO v_item FROM public.request_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item tidak ditemukan';
  END IF;
  IF v_item.item_status NOT IN ('pending_sebagian', 'menunggu_stok') THEN
    RAISE EXCEPTION 'Hanya item yang masih pending (belum terkirim) yang bisa dibatalkan (status: %)', v_item.item_status;
  END IF;

  SELECT * INTO v_req FROM public.requests WHERE id = v_item.request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Permintaan tidak ditemukan';
  END IF;

  -- PERBAIKAN KRITIS: bila sebagian barang SUDAH terkirim (qty_shipped > 0),
  -- JANGAN hapus barisnya (dan JANGAN hapus permintaannya), karena akan
  -- menghilangkan bukti kirim & memicu trigger purge stok! Cukup tutup sisa
  -- yang belum dikirim dengan menyamakan qty_approved = qty_shipped.
  IF COALESCE(v_item.qty_shipped, 0) > 0 THEN
    UPDATE public.request_items
       SET qty_approved = v_item.qty_shipped,
           item_status  = 'terkirim',
           notes        = COALESCE(NULLIF(btrim(v_item.notes), '') || E'\n', '')
                          || '[Sisa belum terkirim dibatalkan Super Admin]',
           updated_at   = now()
     WHERE id = p_item_id;
    v_closed_partial := true;
  ELSE
    DELETE FROM public.request_items WHERE id = p_item_id;
  END IF;

  SELECT COUNT(*) INTO v_remaining
    FROM public.request_items
   WHERE request_id = v_item.request_id;

  IF v_remaining = 0 THEN
    DELETE FROM public.requests WHERE id = v_item.request_id;
    v_request_deleted := true;
  ELSE
    -- Hitung ulang status header permintaan agar tidak nyangkut di disetujui_sebagian.
    IF v_req.status IN ('disetujui', 'disetujui_sebagian', 'diproses', 'selesai') THEN
      v_new_status := CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM public.request_items
           WHERE request_id = v_item.request_id
             AND item_status NOT IN ('terkirim', 'ditolak')
        ) THEN 'selesai'
        WHEN EXISTS (
          SELECT 1 FROM public.request_items
           WHERE request_id = v_item.request_id
             AND item_status IN ('pending_sebagian', 'menunggu_stok')
        ) THEN 'disetujui_sebagian'
        ELSE 'diproses'
      END;
      IF v_new_status IS DISTINCT FROM v_req.status THEN
        UPDATE public.requests
           SET status = v_new_status,
               updated_at = now()
         WHERE id = v_item.request_id;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'request_number',  v_req.request_number,
    'ticket_no',       v_req.ticket_no,
    'request_deleted', v_request_deleted,
    'closed_partial',  v_closed_partial,
    'status',          COALESCE(v_new_status, v_req.status)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_pending_request_item(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_pending_request_item(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. Perbaikan admin_move_stock_between_items & admin_change_request_item (P0)
--    (Hilangkan tabrakan idempotency_key antar tiket yang berbeda!)
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_move_stock_between_items(uuid, uuid, uuid, uuid, numeric, text, text);
DROP FUNCTION IF EXISTS public.admin_move_stock_between_items(uuid, uuid, uuid, uuid, numeric, text, text, text);

CREATE OR REPLACE FUNCTION public.admin_move_stock_between_items(
  p_from_item_id     uuid,
  p_from_location_id uuid,
  p_to_item_id       uuid,
  p_to_location_id   uuid,
  p_qty              numeric,
  p_reason           text DEFAULT NULL,
  p_reference        text DEFAULT NULL,
  p_idempotency_key  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_from_name text;
  v_to_name   text;
  v_from_loc  text;
  v_to_loc    text;
  v_key       text;
  v_in_txn    uuid;
  v_out_txn   uuid;
  v_in_doc    text;
  v_out_doc   text;
  v_in_done   boolean := false;
  v_out_done  boolean := false;
  v_notes     text;
BEGIN
  IF NOT (public.is_super_admin() OR public.is_service_role()) THEN
    RAISE EXCEPTION 'Hanya Super Admin yang boleh memindahkan stok antar barang';
  END IF;
  IF p_from_item_id IS NULL OR p_to_item_id IS NULL
     OR p_from_location_id IS NULL OR p_to_location_id IS NULL THEN
    RAISE EXCEPTION 'Barang & lokasi asal/tujuan wajib diisi';
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'Qty koreksi harus lebih dari 0';
  END IF;

  SELECT name INTO v_from_name FROM public.inventory_items WHERE id = p_from_item_id;
  SELECT name INTO v_to_name   FROM public.inventory_items WHERE id = p_to_item_id;
  SELECT code INTO v_from_loc  FROM public.locations WHERE id = p_from_location_id;
  SELECT code INTO v_to_loc    FROM public.locations WHERE id = p_to_location_id;

  IF v_from_name IS NULL OR v_to_name IS NULL THEN
    RAISE EXCEPTION 'Barang asal/tujuan tidak ditemukan';
  END IF;
  IF v_from_loc IS NULL OR v_to_loc IS NULL THEN
    RAISE EXCEPTION 'Lokasi asal/tujuan tidak ditemukan';
  END IF;

  IF p_from_item_id = p_to_item_id AND p_from_location_id = p_to_location_id THEN
    RETURN jsonb_build_object(
      'moved', false,
      'note',  'Barang & lokasi sama, tidak ada yang dipindahkan'
    );
  END IF;

  v_notes := 'Koreksi data permintaan: ' || v_from_name || ' (' || v_from_loc || ') -> '
             || v_to_name || ' (' || v_to_loc || ') sebanyak ' || p_qty::text
             || CASE WHEN NULLIF(btrim(COALESCE(p_reason, '')), '') IS NOT NULL
                     THEN '. Alasan: ' || btrim(p_reason) ELSE '' END;

  -- Pakai p_idempotency_key spesifik (mis. memuat request_item_id) bila diberikan;
  -- bila tidak diberikan, buat kunci unik agar tidak pernah bentrok antar tiket!
  v_key := COALESCE(
    NULLIF(btrim(COALESCE(p_idempotency_key, '')), ''),
    'KOREKSI-ITEM/' || gen_random_uuid()::text
  );

  SELECT id, doc_number INTO v_in_txn, v_in_doc
    FROM public.inventory_transactions
   WHERE idempotency_key = v_key || '/IN';
  IF v_in_txn IS NULL THEN
    INSERT INTO public.inventory_transactions (
      type, status, transaction_date, dest_location_id, notes, reference,
      idempotency_key, created_by, posted_at
    ) VALUES (
      'in', 'posted', public.today_wib(), p_from_location_id, v_notes,
      COALESCE(p_reference, 'KOREKSI-ITEM'), v_key || '/IN', auth.uid(), now()
    )
    RETURNING id, doc_number INTO v_in_txn, v_in_doc;

    INSERT INTO public.inventory_transaction_items (transaction_id, item_id, qty, notes)
    VALUES (v_in_txn, p_from_item_id, p_qty, 'Pengembalian stok: barang permintaan diganti');

    PERFORM public._apply_posted_effects(v_in_txn, true);
    v_in_done := true;
  END IF;

  SELECT id, doc_number INTO v_out_txn, v_out_doc
    FROM public.inventory_transactions
   WHERE idempotency_key = v_key || '/OUT';
  IF v_out_txn IS NULL THEN
    INSERT INTO public.inventory_transactions (
      type, status, transaction_date, source_location_id, notes, reference,
      idempotency_key, created_by, posted_at
    ) VALUES (
      'out', 'posted', public.today_wib(), p_to_location_id, v_notes,
      COALESCE(p_reference, 'KOREKSI-ITEM'), v_key || '/OUT', auth.uid(), now()
    )
    RETURNING id, doc_number INTO v_out_txn, v_out_doc;

    INSERT INTO public.inventory_transaction_items (transaction_id, item_id, qty, notes)
    VALUES (v_out_txn, p_to_item_id, p_qty, 'Pemotongan stok: barang permintaan baru');

    PERFORM public._apply_posted_effects(v_out_txn, true);
    v_out_done := true;
  END IF;

  RETURN jsonb_build_object(
    'moved',         v_in_done OR v_out_done,
    'qty',           p_qty,
    'from_item',     v_from_name,
    'to_item',       v_to_name,
    'from_location', v_from_loc,
    'to_location',   v_to_loc,
    'in_doc',        v_in_doc,
    'out_doc',       v_out_doc
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_move_stock_between_items(uuid, uuid, uuid, uuid, numeric, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_move_stock_between_items(uuid, uuid, uuid, uuid, numeric, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_change_request_item(
  p_request_item_id  uuid,
  p_new_item_id      uuid,
  p_new_status_aset  text,
  p_reason           text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ri         record;
  v_req_number text;
  v_ticket     text;
  v_new_item   uuid;
  v_old_status text;
  v_new_status text;
  v_old_loc    uuid;
  v_new_loc    uuid;
  v_qty        numeric;
  v_rev_seq    integer;
  v_idem_key   text;
  v_move       jsonb := NULL;
BEGIN
  IF NOT (public.is_super_admin() OR public.is_service_role()) THEN
    RAISE EXCEPTION 'Hanya Super Admin yang boleh mengubah barang pada permintaan';
  END IF;

  SELECT * INTO v_ri
    FROM public.request_items
   WHERE id = p_request_item_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Baris permintaan tidak ditemukan';
  END IF;

  SELECT request_number, ticket_no
    INTO v_req_number, v_ticket
    FROM public.requests
   WHERE id = v_ri.request_id;

  v_new_item := COALESCE(p_new_item_id, v_ri.item_id);

  v_old_status := CASE
    WHEN upper(COALESCE(v_ri.status_aset, '')) LIKE '%UNREADY%' THEN 'UNREADY'
    WHEN upper(COALESCE(v_ri.status_aset, '')) LIKE '%RETUR%'   THEN 'ASSET RETUR'
    ELSE 'ASSET BARU'
  END;
  v_new_status := CASE
    WHEN upper(COALESCE(p_new_status_aset, v_ri.status_aset, '')) LIKE '%UNREADY%' THEN 'UNREADY'
    WHEN upper(COALESCE(p_new_status_aset, v_ri.status_aset, '')) LIKE '%RETUR%'   THEN 'ASSET RETUR'
    ELSE 'ASSET BARU'
  END;

  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_items WHERE id = v_new_item AND is_active
  ) THEN
    RAISE EXCEPTION 'Barang tujuan tidak ditemukan atau tidak aktif';
  END IF;

  v_qty := COALESCE(v_ri.qty_shipped, 0);

  IF v_qty > 0 AND (v_new_item <> v_ri.item_id OR v_new_status <> v_old_status) THEN
    SELECT id INTO v_old_loc FROM public.locations
     WHERE code = CASE v_old_status
                    WHEN 'ASSET RETUR' THEN 'STOK-RETUR'
                    WHEN 'UNREADY'     THEN 'STOK-UNREADY'
                    ELSE 'STOK-BARU'
                  END
       AND is_active
     LIMIT 1;
    SELECT id INTO v_new_loc FROM public.locations
     WHERE code = CASE v_new_status
                    WHEN 'ASSET RETUR' THEN 'STOK-RETUR'
                    WHEN 'UNREADY'     THEN 'STOK-UNREADY'
                    ELSE 'STOK-BARU'
                  END
       AND is_active
     LIMIT 1;

    IF v_old_loc IS NULL OR v_new_loc IS NULL THEN
      RAISE EXCEPTION 'Lokasi stok untuk Status Aset % / % belum tersedia',
        v_old_status, v_new_status;
    END IF;

    -- Kunci spesifik per baris request_item_id + nomor revisi baris itu,
    -- sehingga tiket berbeda (atau koreksi ulang A->B->A) tidak pernah tabrakan.
    SELECT count(*) INTO v_rev_seq
      FROM public.inventory_transactions
     WHERE idempotency_key LIKE 'KOREKSI-ITEM/' || p_request_item_id::text || '/%/IN';

    v_idem_key := 'KOREKSI-ITEM/' || p_request_item_id::text || '/r' || (v_rev_seq + 1)::text;

    v_move := public.admin_move_stock_between_items(
      v_ri.item_id, v_old_loc,
      v_new_item,   v_new_loc,
      v_qty,
      COALESCE(
        NULLIF(btrim(COALESCE(p_reason, '')), ''),
        'Ubah barang pada permintaan ' || COALESCE(v_ticket, v_req_number, v_ri.request_id::text)
      ),
      'KOREKSI-ITEM/' || COALESCE(v_req_number, v_ri.request_id::text),
      v_idem_key
    );
  END IF;

  UPDATE public.request_items
     SET item_id     = v_new_item,
         status_aset = v_new_status,
         updated_at  = now()
   WHERE id = p_request_item_id;

  RETURN jsonb_build_object(
    'ok',             true,
    'request_number', v_req_number,
    'qty_shipped',    v_qty,
    'old_item_id',    v_ri.item_id,
    'new_item_id',    v_new_item,
    'old_status',     v_old_status,
    'new_status',     v_new_status,
    'stock_move',     v_move
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_change_request_item(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_change_request_item(uuid, uuid, text, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 6. Perbaikan void_inventory_transaction (P0: row lock, guard REQ/PO, snapshot audit)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.void_inventory_transaction(p_transaction_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_txn       record;
  r           record;
  v_count     int := 0;
  v_new_qty   numeric(15,3);
  v_is_linked boolean := false;
  v_items_snap  jsonb;
  v_ledger_snap jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Hanya super admin yang bisa menghapus log transaksi';
  END IF;

  SELECT * INTO v_txn
    FROM public.inventory_transactions
   WHERE id = p_transaction_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaksi tidak ditemukan';
  END IF;

  -- Blokir hapus transaksi yang terikat ke Permintaan atau Purchase Order
  -- agar qty_shipped / qty_received tidak pernah terputus dari stok!
  WITH RECURSIVE ancestors(id, reference, reversal_of) AS (
    SELECT id, reference, reversal_of
      FROM public.inventory_transactions
     WHERE id = p_transaction_id
    UNION
    SELECT parent.id, parent.reference, parent.reversal_of
      FROM public.inventory_transactions parent
      JOIN ancestors current
        ON current.reversal_of = parent.id
        OR current.reference = 'KOREKSI-ADMIN/' || parent.id::text
  )
  SELECT EXISTS (
    SELECT 1 FROM ancestors
     WHERE reference LIKE 'REQ-KIRIM/%'
        OR reference LIKE 'HAPUS-ITEM/%'
        OR reference LIKE 'PO/%'
  ) INTO v_is_linked;

  IF v_is_linked THEN
    IF v_txn.reference LIKE 'PO/%' THEN
      RAISE EXCEPTION 'Transaksi penerimaan PO tidak boleh dihapus langsung dari Log — gunakan Koreksi (Reverse) agar riwayat PO tetap konsisten';
    END IF;
    RAISE EXCEPTION 'Transaksi pengiriman permintaan harus dihapus melalui menu Permintaan agar stok dan detail permintaan tetap konsisten';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.inventory_transactions WHERE reversal_of = p_transaction_id
  ) THEN
    RAISE EXCEPTION 'Transaksi ini sudah memiliki dokumen koreksi/reversal — hapus dokumen koreksinya terlebih dahulu';
  END IF;

  -- Ambil snapshot penuh sebelum dihapus agar jejak audit tidak pernah hilang.
  SELECT COALESCE(jsonb_agg(to_jsonb(tii)), '[]'::jsonb) INTO v_items_snap
    FROM public.inventory_transaction_items tii
   WHERE tii.transaction_id = p_transaction_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(ld)), '[]'::jsonb) INTO v_ledger_snap
    FROM public.inventory_ledger ld
   WHERE ld.transaction_id = p_transaction_id;

  -- Kunci baris saldo secara terurut (anti-deadlock) lalu balikkan saldo.
  FOR r IN
    SELECT item_id, location_id, SUM(qty_change) AS net_change
      FROM public.inventory_ledger
     WHERE transaction_id = p_transaction_id
     GROUP BY item_id, location_id
     ORDER BY item_id, location_id
  LOOP
    SELECT qty - r.net_change INTO v_new_qty
      FROM public.inventory_balances
     WHERE item_id = r.item_id AND location_id = r.location_id
     FOR UPDATE;

    IF v_new_qty IS NULL THEN
      RAISE EXCEPTION 'Saldo tidak ditemukan untuk item/lokasi';
    END IF;
    IF v_new_qty < 0 THEN
      RAISE EXCEPTION 'Tidak bisa dihapus: stok akan menjadi negatif (ada transaksi lain yang memakai stok ini)';
    END IF;

    UPDATE public.inventory_balances
       SET qty = v_new_qty, updated_at = now()
     WHERE item_id = r.item_id AND location_id = r.location_id;

    v_count := v_count + 1;
  END LOOP;

  -- Simpan snapshot audit lengkap sebelum baris ledger/item dihapus.
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, old_data, new_data)
  VALUES (
    auth.uid(), 'VOID', 'inventory_transactions', p_transaction_id::text,
    jsonb_build_object(
      'transaction', to_jsonb(v_txn),
      'items', v_items_snap,
      'ledger', v_ledger_snap
    ),
    NULL
  );

  DELETE FROM public.inventory_ledger WHERE transaction_id = p_transaction_id;
  DELETE FROM public.inventory_transaction_items WHERE transaction_id = p_transaction_id;
  DELETE FROM public.inventory_transactions WHERE id = p_transaction_id;

  RETURN jsonb_build_object('deleted', true, 'doc', v_txn.doc_number, 'ledger_rows', v_count);
END;
$$;
REVOKE ALL ON FUNCTION public.void_inventory_transaction(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_inventory_transaction(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 7. RPC atomik: split_request_item (pecah 1 baris qty N menjadi N baris @1)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.split_request_item(p_request_item_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ri           record;
  v_n            integer;
  v_barcodes     text[];
  v_resis        text[];
  v_sns          text[] := ARRAY[]::text[];
  v_other_notes  text[] := ARRAY[]::text[];
  v_line         text;
  v_shared_notes text;
  v_notes_i      text;
  i              integer;
BEGIN
  IF NOT (
    public.has_permission('requests.review')
    OR public.has_permission('requests.approve')
    OR public.has_permission('requests.process')
    OR public.is_super_admin()
  ) THEN
    RAISE EXCEPTION 'Tidak punya izin memecah baris permintaan';
  END IF;

  SELECT * INTO v_ri
    FROM public.request_items
   WHERE id = p_request_item_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Baris permintaan tidak ditemukan';
  END IF;
  IF COALESCE(v_ri.qty_shipped, 0) > 0 THEN
    RAISE EXCEPTION 'Item sudah ada yang terkirim — tidak bisa di-split';
  END IF;

  v_n := ROUND(COALESCE(v_ri.qty_approved, v_ri.qty_requested, 0))::integer;
  IF v_n <= 1 THEN
    RAISE EXCEPTION 'Qty baris harus lebih dari 1 untuk di-split';
  END IF;

  v_barcodes := string_to_array(COALESCE(v_ri.barcode, ''), E'\n');
  v_resis    := string_to_array(COALESCE(v_ri.resi, ''), E'\n');

  FOR v_line IN SELECT unnest(string_to_array(COALESCE(v_ri.notes, ''), E'\n'))
  LOOP
    IF v_line ~* '^Ket:\s*(.+)$' THEN
      v_sns := v_sns || btrim(regexp_replace(v_line, '^Ket:\s*', '', 'i'));
    ELSIF btrim(v_line) <> '' THEN
      v_other_notes := v_other_notes || btrim(v_line);
    END IF;
  END LOOP;

  IF cardinality(v_sns) = 0 AND NULLIF(btrim(COALESCE(v_ri.serial_number, '')), '') IS NOT NULL THEN
    SELECT COALESCE(array_agg(btrim(x)), ARRAY[]::text[]) INTO v_sns
      FROM unnest(string_to_array(v_ri.serial_number, E'\n')) AS x
     WHERE btrim(x) <> '';
  END IF;

  v_shared_notes := NULLIF(array_to_string(v_other_notes, E'\n'), '');

  -- Baris 1: update baris asli menjadi qty 1.
  v_notes_i := NULLIF(
    concat_ws(E'\n',
      CASE WHEN NULLIF(btrim(COALESCE(v_sns[1], '')), '') IS NOT NULL THEN 'Ket: ' || btrim(v_sns[1]) END,
      v_shared_notes
    ), ''
  );

  UPDATE public.request_items
     SET qty_requested = 1,
         qty_approved  = CASE WHEN v_ri.qty_approved IS NOT NULL THEN 1 ELSE NULL END,
         barcode       = NULLIF(btrim(COALESCE(v_barcodes[1], '')), ''),
         serial_number = NULLIF(btrim(COALESCE(v_sns[1], '')), ''),
         resi          = NULLIF(btrim(COALESCE(v_resis[1], '')), ''),
         notes         = v_notes_i,
         updated_at    = now()
   WHERE id = v_ri.id;

  -- Baris 2..N: insert baru secara atomik dalam transaksi yang sama.
  FOR i IN 2..v_n LOOP
    v_notes_i := NULLIF(
      concat_ws(E'\n',
        CASE WHEN NULLIF(btrim(COALESCE(v_sns[i], '')), '') IS NOT NULL THEN 'Ket: ' || btrim(v_sns[i]) END,
        v_shared_notes
      ), ''
    );

    INSERT INTO public.request_items (
      request_id, item_id, qty_requested, qty_approved, qty_shipped,
      barcode, serial_number, resi, item_type, status_aset, item_status, notes
    )
    VALUES (
      v_ri.request_id, v_ri.item_id, 1,
      CASE WHEN v_ri.qty_approved IS NOT NULL THEN 1 ELSE NULL END,
      0,
      NULLIF(btrim(COALESCE(v_barcodes[i], '')), ''),
      NULLIF(btrim(COALESCE(v_sns[i], '')), ''),
      NULLIF(btrim(COALESCE(v_resis[i], '')), ''),
      v_ri.item_type, v_ri.status_aset, v_ri.item_status, v_notes_i
    );
  END LOOP;

  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.split_request_item(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.split_request_item(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 8. Perbaikan finalize_stock_count (today_wib + skip transaksi OPN kosong)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_stock_count(p_stock_count_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  sc          record;
  ci          record;
  v_sys       numeric(15,3);
  v_new_id    uuid;
  v_doc       text;
  v_key       text;
  v_diff_rows integer := 0;
BEGIN
  SELECT * INTO sc
    FROM public.stock_counts
   WHERE id = p_stock_count_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock opname % tidak ditemukan', p_stock_count_id;
  END IF;
  IF sc.status <> 'draft' THEN
    RAISE EXCEPTION 'Hanya opname berstatus draft yang bisa difinalisasi (status: %)', sc.status;
  END IF;
  IF NOT public.has_permission('inventory.adjust') THEN
    RAISE EXCEPTION 'Izin ditolak: butuh permission inventory.adjust';
  END IF;

  FOR ci IN
    SELECT *
      FROM public.stock_count_items
     WHERE stock_count_id = sc.id
     ORDER BY item_id
     FOR UPDATE
  LOOP
    IF ci.counted_qty IS NULL THEN
      RAISE EXCEPTION 'Item % belum dihitung (counted_qty masih kosong)', ci.item_id;
    END IF;

    INSERT INTO public.inventory_balances (item_id, location_id, qty)
    VALUES (ci.item_id, sc.location_id, 0)
    ON CONFLICT DO NOTHING;

    SELECT qty INTO v_sys
      FROM public.inventory_balances
     WHERE item_id = ci.item_id AND location_id = sc.location_id
     FOR UPDATE;

    UPDATE public.stock_count_items
       SET system_qty = COALESCE(v_sys, 0)
     WHERE id = ci.id;
  END LOOP;

  SELECT COUNT(*) INTO v_diff_rows
    FROM public.stock_count_items
   WHERE stock_count_id = sc.id
     AND (counted_qty - system_qty) <> 0;

  -- Bila seluruh barang cocok (0 selisih), tandai posted tanpa membuat
  -- dokumen transaksi OPN kosong di riwayat.
  IF v_diff_rows = 0 THEN
    UPDATE public.stock_counts
       SET status = 'posted',
           posted_at = now()
     WHERE id = sc.id;
    RETURN sc.doc_number;
  END IF;

  v_key := 'opname-' || sc.id::text;
  v_doc := public.next_doc_number('OPN');

  INSERT INTO public.inventory_transactions (
    doc_number, type, status, transaction_date,
    source_location_id, dest_location_id,
    reference, notes, idempotency_key, created_by, posted_at
  )
  VALUES (
    v_doc, 'opname', 'posted', public.today_wib(),
    sc.location_id, NULL,
    'Opname ' || sc.doc_number, sc.notes,
    v_key, auth.uid(), now()
  )
  RETURNING id INTO v_new_id;

  INSERT INTO public.inventory_transaction_items
    (transaction_id, item_id, qty, notes)
  SELECT v_new_id, item_id, (counted_qty - system_qty),
         'selisih opname ' || sc.doc_number
    FROM public.stock_count_items
   WHERE stock_count_id = sc.id
     AND (counted_qty - system_qty) <> 0;

  PERFORM public._apply_posted_effects(v_new_id);

  UPDATE public.stock_counts
     SET status = 'posted',
         posted_at = now()
   WHERE id = sc.id;

  RETURN v_doc;
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_stock_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_stock_count(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 9. Perbaikan tanggal WIB pada reverse_inventory_transaction,
--    admin_correct_txn_item, admin_delete_request_item
-- -----------------------------------------------------------------------------
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
  r            record;
  v_new_id     uuid;
  v_doc        text;
  v_key        text;
  v_req        text;
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

  v_new_type := CASE r.type
    WHEN 'out'    THEN 'in'
    WHEN 'in'     THEN 'out'
    WHEN 'return' THEN 'out'
    ELSE r.type
  END;
  v_new_source := CASE
    WHEN r.type = 'out'             THEN NULL
    WHEN r.type IN ('in', 'return') THEN r.dest_location_id
    WHEN r.type = 'transfer'        THEN r.dest_location_id
    ELSE r.source_location_id
  END;
  v_new_dest := CASE
    WHEN r.type = 'out'             THEN r.source_location_id
    WHEN r.type IN ('in', 'return') THEN NULL
    WHEN r.type = 'transfer'        THEN r.source_location_id
    ELSE r.dest_location_id
  END;

  v_req := public._txn_required_permission(v_new_type);
  IF NOT (public.has_permission(v_req) OR public.is_super_admin()) THEN
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
    v_doc, v_new_type, 'posted', public.today_wib(),
    v_new_source, v_new_dest,
    'Koreksi atas ' || r.doc_number, btrim(p_reason),
    v_key, auth.uid(), now(),
    r.id, btrim(p_reason)
  )
  RETURNING id INTO v_new_id;

  INSERT INTO public.inventory_transaction_items
    (transaction_id, item_id, qty, unit_price, notes, resi, gerai, status_aset)
  SELECT v_new_id, item_id,
         CASE WHEN r.type IN ('adjust', 'opname') THEN -qty ELSE qty END,
         unit_price, 'koreksi atas ' || r.doc_number,
         resi, gerai, status_aset
    FROM public.inventory_transaction_items
   WHERE transaction_id = r.id;

  PERFORM public._apply_posted_effects(v_new_id, true);

  UPDATE public.inventory_transactions
     SET status = 'reversed',
         reversed_at = now()
   WHERE id = r.id;

  RETURN v_doc;
END;
$$;
REVOKE ALL ON FUNCTION public.reverse_inventory_transaction(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reverse_inventory_transaction(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_correct_txn_item(
  p_transaction_id  uuid,
  p_item_id         uuid,
  p_new_status_aset text,
  p_reason          text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_txn            record;
  v_tii            record;
  v_norm           text;
  v_new_loc        uuid;
  v_original_loc   uuid;
  v_effective_loc  uuid;
  v_from_loc       uuid;
  v_to_loc         uuid;
  v_corr_id        uuid;
  v_doc            text;
  v_moved          boolean := false;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Hanya super admin yang boleh mengoreksi log transaksi';
  END IF;

  v_norm := CASE
    WHEN upper(COALESCE(p_new_status_aset, '')) LIKE '%UNREADY%' THEN 'UNREADY'
    WHEN upper(COALESCE(p_new_status_aset, '')) LIKE '%RETUR%'
      OR upper(COALESCE(p_new_status_aset, '')) LIKE '%RETURN%' THEN 'ASSET RETUR'
    ELSE 'ASSET BARU'
  END;

  SELECT * INTO v_txn
    FROM public.inventory_transactions
   WHERE id = p_transaction_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaksi tidak ditemukan';
  END IF;
  IF v_txn.status <> 'posted' THEN
    RAISE EXCEPTION 'Hanya transaksi posted yang bisa dikoreksi (status: %)', v_txn.status;
  END IF;
  IF v_txn.type NOT IN ('in', 'out') THEN
    RAISE EXCEPTION 'Koreksi jenis stok hanya untuk transaksi masuk/keluar (tipe: %)', v_txn.type;
  END IF;

  SELECT * INTO v_tii
    FROM public.inventory_transaction_items
   WHERE transaction_id = p_transaction_id
     AND item_id = p_item_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item transaksi tidak ditemukan';
  END IF;

  v_original_loc := CASE
    WHEN v_txn.type = 'out' THEN v_txn.source_location_id
    ELSE v_txn.dest_location_id
  END;
  IF v_original_loc IS NULL THEN
    RAISE EXCEPTION 'Lokasi asal/tujuan transaksi tidak tersedia';
  END IF;

  SELECT id INTO v_new_loc
    FROM public.locations
   WHERE code = CASE v_norm
                  WHEN 'ASSET RETUR' THEN 'STOK-RETUR'
                  WHEN 'UNREADY'     THEN 'STOK-UNREADY'
                  ELSE 'STOK-BARU'
                END
     AND is_active
   LIMIT 1;
  IF v_new_loc IS NULL THEN
    RAISE EXCEPTION 'Lokasi untuk jenis stok % tidak ditemukan', v_norm;
  END IF;

  SELECT CASE
           WHEN v_txn.type = 'out' THEN c.source_location_id
           ELSE c.dest_location_id
         END
    INTO v_effective_loc
    FROM public.inventory_transactions c
    JOIN public.inventory_transaction_items ci ON ci.transaction_id = c.id
   WHERE c.reference = 'KOREKSI-ADMIN/' || p_transaction_id::text
     AND c.type = 'transfer'
     AND c.status = 'posted'
     AND ci.item_id = p_item_id
   ORDER BY c.created_at DESC, c.id DESC
   LIMIT 1;
  v_effective_loc := COALESCE(v_effective_loc, v_original_loc);

  IF v_tii.status_aset = v_norm AND v_effective_loc = v_new_loc THEN
    RETURN jsonb_build_object(
      'moved', false, 'doc', NULL,
      'old_status', v_tii.status_aset, 'new_status', v_norm,
      'note', 'Tidak ada perubahan'
    );
  END IF;

  IF v_new_loc <> v_effective_loc THEN
    IF v_txn.type = 'out' THEN
      v_from_loc := v_new_loc;
      v_to_loc   := v_effective_loc;
    ELSE
      v_from_loc := v_effective_loc;
      v_to_loc   := v_new_loc;
    END IF;

    INSERT INTO public.inventory_transactions (
      type, status, transaction_date,
      source_location_id, dest_location_id,
      notes, reference, created_by, posted_at
    )
    VALUES (
      'transfer', 'posted', public.today_wib(),
      v_from_loc, v_to_loc,
      'Koreksi jenis stok oleh super admin' ||
        CASE WHEN NULLIF(btrim(COALESCE(p_reason, '')), '') IS NOT NULL
             THEN ': ' || btrim(p_reason) ELSE '' END ||
        ' (dok asal: ' || COALESCE(v_txn.doc_number, v_txn.id::text) || ')',
      'KOREKSI-ADMIN/' || p_transaction_id::text,
      auth.uid(), now()
    )
    RETURNING id INTO v_corr_id;

    INSERT INTO public.inventory_transaction_items (
      transaction_id, item_id, qty, notes, resi, gerai, status_aset
    )
    VALUES (
      v_corr_id, p_item_id, v_tii.qty,
      'Koreksi: ' || COALESCE(v_tii.status_aset, '-') || ' → ' || v_norm,
      v_tii.resi, v_tii.gerai, v_norm
    );

    PERFORM public._apply_posted_effects(v_corr_id, true);
    v_moved := true;
    SELECT doc_number INTO v_doc
      FROM public.inventory_transactions
     WHERE id = v_corr_id;
  END IF;

  UPDATE public.inventory_transaction_items
     SET status_aset = v_norm,
         updated_at  = now()
   WHERE transaction_id = p_transaction_id
     AND item_id = p_item_id;

  RETURN jsonb_build_object(
    'moved', v_moved,
    'doc', v_doc,
    'old_status', v_tii.status_aset,
    'new_status', v_norm
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_correct_txn_item(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_correct_txn_item(uuid, uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_request_item(
  p_request_item_id uuid,
  p_reason          text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ri          record;
  v_req_number  text;
  v_ticket      text;
  v_req_status  text;
  v_qty         numeric;
  v_norm        text;
  v_loc_code    text;
  v_loc_id      uuid;
  v_txn_id      uuid;
  v_doc         text;
  v_new_status  text;
  v_remaining   integer;
BEGIN
  IF NOT (public.is_super_admin() OR public.is_service_role()) THEN
    RAISE EXCEPTION 'Hanya Super Admin yang boleh menghapus baris permintaan';
  END IF;

  SELECT * INTO v_ri
    FROM public.request_items
   WHERE id = p_request_item_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Baris permintaan tidak ditemukan';
  END IF;

  SELECT status, request_number, ticket_no
    INTO v_req_status, v_req_number, v_ticket
    FROM public.requests
   WHERE id = v_ri.request_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Permintaan tidak ditemukan';
  END IF;

  SELECT count(*) INTO v_remaining
    FROM public.request_items
   WHERE request_id = v_ri.request_id
     AND id <> v_ri.id;

  IF v_remaining = 0 THEN
    RAISE EXCEPTION 'Ini baris terakhir permintaan. Untuk membuang seluruh tiket, hapus permintaannya dari menu Permintaan.';
  END IF;

  v_qty := COALESCE(v_ri.qty_shipped, 0);
  v_doc := NULL;

  IF v_qty > 0 THEN
    v_norm := CASE
      WHEN upper(COALESCE(v_ri.status_aset, '')) LIKE '%UNREADY%' THEN 'UNREADY'
      WHEN upper(COALESCE(v_ri.status_aset, '')) LIKE '%RETUR%'   THEN 'ASSET RETUR'
      ELSE 'ASSET BARU'
    END;
    v_loc_code := CASE v_norm
      WHEN 'UNREADY'     THEN 'STOK-UNREADY'
      WHEN 'ASSET RETUR' THEN 'STOK-RETUR'
      ELSE 'STOK-BARU'
    END;

    SELECT id INTO v_loc_id
      FROM public.locations
     WHERE code = v_loc_code
       AND is_active
     LIMIT 1;

    IF v_loc_id IS NULL THEN
      RAISE EXCEPTION 'Lokasi stok % tidak ditemukan — pengembalian stok dibatalkan', v_loc_code;
    END IF;

    SELECT id, doc_number INTO v_txn_id, v_doc
      FROM public.inventory_transactions
     WHERE idempotency_key = 'HAPUS-ITEM/' || p_request_item_id::text;

    IF v_txn_id IS NULL THEN
      INSERT INTO public.inventory_transactions (
        type, status, transaction_date, dest_location_id, notes, reference,
        idempotency_key, created_by, posted_at
      ) VALUES (
        'in', 'posted', public.today_wib(), v_loc_id,
        'Pengembalian stok: baris permintaan dihapus ('
          || CASE WHEN NULLIF(btrim(COALESCE(v_ticket, '')), '') IS NOT NULL
                  THEN v_ticket ELSE v_req_number END || ')'
          || CASE WHEN NULLIF(btrim(COALESCE(p_reason, '')), '') IS NOT NULL
                  THEN '. Alasan: ' || btrim(p_reason) ELSE '' END,
        'HAPUS-ITEM/' || v_req_number,
        'HAPUS-ITEM/' || p_request_item_id::text,
        auth.uid(),
        now()
      )
      RETURNING id, doc_number INTO v_txn_id, v_doc;

      INSERT INTO public.inventory_transaction_items
        (transaction_id, item_id, qty, notes, status_aset)
      VALUES
        (v_txn_id, v_ri.item_id, v_qty,
         'Pengembalian stok: baris permintaan dihapus', v_norm);

      PERFORM public._apply_posted_effects(v_txn_id, true);
    END IF;
  END IF;

  DELETE FROM public.request_items
   WHERE id = p_request_item_id;

  IF v_req_status IN ('disetujui', 'disetujui_sebagian', 'diproses', 'selesai') THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.request_items
       WHERE request_id = v_ri.request_id
         AND item_status NOT IN ('terkirim', 'ditolak')
    ) THEN
      v_new_status := 'selesai';
    ELSIF EXISTS (
      SELECT 1 FROM public.request_items
       WHERE request_id = v_ri.request_id
         AND item_status IN ('pending_sebagian', 'menunggu_stok')
    ) THEN
      v_new_status := 'disetujui_sebagian';
    ELSE
      v_new_status := v_req_status;
    END IF;

    IF v_new_status IS DISTINCT FROM v_req_status THEN
      UPDATE public.requests
         SET status = v_new_status,
             updated_at = now()
       WHERE id = v_ri.request_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok',             true,
    'qty_restored',   v_qty,
    'in_doc',         v_doc,
    'request_number', v_req_number,
    'status',         COALESCE(v_new_status, v_req_status)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_delete_request_item(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_request_item(uuid, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 10. Storage bucket surat-jalan: perbaiki izin receive/issue & tutup listing anonim
--     Catatan: bucket tetap public=true sementara agar URL lama tidak putus
--     sebelum frontend baru (ProofImage signed URL) di-deploy. Setelah deploy
--     frontend selesai, Anda boleh jalankan (opsional):
--       UPDATE storage.buckets SET public = false WHERE id = 'surat-jalan';
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'objects') THEN
    DROP POLICY IF EXISTS "surat-jalan public read" ON storage.objects;
    DROP POLICY IF EXISTS "surat-jalan staff read" ON storage.objects;
    CREATE POLICY "surat-jalan staff read"
    ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'surat-jalan' AND public.is_staff());

    DROP POLICY IF EXISTS "surat-jalan authenticated write" ON storage.objects;
    CREATE POLICY "surat-jalan authenticated write"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'surat-jalan'
      AND (
        public.has_permission('inventory.receive')
        OR public.has_permission('inventory.issue')
        OR public.has_permission('inventory.manage')
        OR public.has_permission('inventory.adjust')
        OR public.has_permission('settings.manage')
        OR public.is_super_admin()
      )
    );

    DROP POLICY IF EXISTS "surat-jalan authenticated update" ON storage.objects;
    CREATE POLICY "surat-jalan authenticated update"
    ON storage.objects FOR UPDATE TO authenticated
    USING (
      bucket_id = 'surat-jalan'
      AND (
        public.has_permission('inventory.receive')
        OR public.has_permission('inventory.issue')
        OR public.has_permission('inventory.manage')
        OR public.has_permission('inventory.adjust')
        OR public.has_permission('settings.manage')
        OR public.is_super_admin()
      )
    );

    DROP POLICY IF EXISTS "surat-jalan authenticated delete" ON storage.objects;
    CREATE POLICY "surat-jalan authenticated delete"
    ON storage.objects FOR DELETE TO authenticated
    USING (
      bucket_id = 'surat-jalan'
      AND (
        public.has_permission('inventory.manage')
        OR public.has_permission('settings.manage')
        OR public.is_super_admin()
      )
    );
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 11. View v_sheet_sync_recent: tutup RLS bypass (security_invoker = true)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.v_sheet_sync_recent') IS NOT NULL THEN
    ALTER VIEW public.v_sheet_sync_recent SET (security_invoker = true);
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 12. Guard Maker-Checker (cegah manipulasi langsung lewat REST API)
--     SECURITY INVOKER: saat dipanggil dari dalam RPC SECURITY DEFINER,
--     current_user adalah pemilik fungsi (postgres), sehingga RPC resmi lolos.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_request_items_workflow()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF auth.uid() IS NULL OR current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN NEW;
  END IF;

  -- Helper (hanya punya requests.process, tanpa review/approve/create) tidak
  -- boleh memanipulasi qty_approved, qty_shipped, atau menyetujui/menolak item.
  IF NOT (
    public.is_super_admin()
    OR public.has_permission('requests.review')
    OR public.has_permission('requests.approve')
    OR public.has_permission('requests.create')
  ) THEN
    IF NEW.qty_approved IS DISTINCT FROM OLD.qty_approved
       OR NEW.qty_shipped IS DISTINCT FROM OLD.qty_shipped
       OR NEW.item_id IS DISTINCT FROM OLD.item_id
       OR (NEW.item_status IS DISTINCT FROM OLD.item_status
           AND NEW.item_status NOT IN ('diproses', 'siap')) THEN
      RAISE EXCEPTION 'Izin ditolak: peran Anda hanya dapat memperbarui status proses (diproses/siap) dan barcode/SN/resi';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.request_items') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_guard_request_items_workflow ON public.request_items;
    CREATE TRIGGER trg_guard_request_items_workflow
      BEFORE UPDATE ON public.request_items
      FOR EACH ROW EXECUTE FUNCTION public.guard_request_items_workflow();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.guard_requests_workflow()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF auth.uid() IS NULL OR current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN NEW;
  END IF;

  IF NOT (
    public.is_super_admin()
    OR public.has_permission('requests.review')
    OR public.has_permission('requests.approve')
  ) THEN
    IF (NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'diproses')
       OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
       OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at THEN
      RAISE EXCEPTION 'Izin ditolak: hanya Admin Gudang / Super Admin yang dapat menyetujui, menolak, atau menyelesaikan permintaan';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.requests') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_guard_requests_workflow ON public.requests;
    CREATE TRIGGER trg_guard_requests_workflow
      BEFORE UPDATE ON public.requests
      FOR EACH ROW EXECUTE FUNCTION public.guard_requests_workflow();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.guard_po_direct_tampering()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF auth.uid() IS NULL OR current_user IN ('postgres', 'supabase_admin', 'service_role')
     OR current_setting('app.in_po_receive', true) = '1' THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'purchase_order_items' THEN
    IF NEW.qty_received IS DISTINCT FROM OLD.qty_received THEN
      RAISE EXCEPTION 'qty_received hanya boleh diubah melalui penerimaan PO (receive_purchase_order)';
    END IF;
  ELSIF TG_TABLE_NAME = 'purchase_orders' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NEW.status IN ('received', 'received_partial') THEN
      RAISE EXCEPTION 'Status penerimaan PO hanya boleh diubah melalui penerimaan PO (receive_purchase_order)';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.purchase_orders') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_guard_po_direct_tampering ON public.purchase_orders;
    CREATE TRIGGER trg_guard_po_direct_tampering
      BEFORE UPDATE ON public.purchase_orders
      FOR EACH ROW EXECUTE FUNCTION public.guard_po_direct_tampering();
  END IF;
  IF to_regclass('public.purchase_order_items') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_guard_poi_direct_tampering ON public.purchase_order_items;
    CREATE TRIGGER trg_guard_poi_direct_tampering
      BEFORE UPDATE ON public.purchase_order_items
      FOR EACH ROW EXECUTE FUNCTION public.guard_po_direct_tampering();
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 13. Lengkapi trigger log_audit() pada seluruh tabel operasional penting
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'requests', 'request_items',
    'purchase_orders', 'purchase_order_items',
    'stock_counts', 'user_accounts',
    'role_permissions', 'user_permissions',
    'warehouses', 'locations', 'suppliers'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%s ON public.%I', t, t);
      EXECUTE format(
        'CREATE TRIGGER trg_audit_%s AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.log_audit()', t, t
      );
    END IF;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 14. RPC agregasi server-side (anti limit 1.000 baris PostgREST + konsisten)
-- -----------------------------------------------------------------------------

-- 14a. Angka badge navigasi (antrean + stok menipis berbasis *-BARU, konsisten
--      dengan Dashboard & halaman Peringatan Stok).
CREATE OR REPLACE FUNCTION public.get_nav_queue_counts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_diajukan  integer := 0;
  v_aktif     integer := 0;
  v_sisa      integer := 0;
  v_low_stock integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF public.has_permission('requests.view') THEN
    SELECT COUNT(*) INTO v_diajukan FROM public.requests WHERE status = 'diajukan';
    SELECT COUNT(*) INTO v_aktif
      FROM public.requests
     WHERE status IN ('disetujui', 'disetujui_sebagian', 'diproses');
    SELECT COUNT(*) INTO v_sisa
      FROM public.request_items
     WHERE item_status IN ('pending_sebagian', 'menunggu_stok')
       AND (COALESCE(qty_approved, qty_requested) - COALESCE(qty_shipped, 0)) > 0;
  END IF;

  IF public.has_permission('inventory.view') THEN
    WITH ready_stock AS (
      SELECT b.item_id, COALESCE(SUM(b.qty), 0) AS qty
        FROM public.inventory_balances b
        JOIN public.locations l ON l.id = b.location_id
       WHERE upper(l.code) LIKE '%-BARU'
       GROUP BY b.item_id
    )
    SELECT COUNT(*) INTO v_low_stock
      FROM public.inventory_items i
      LEFT JOIN ready_stock rs ON rs.item_id = i.id
     WHERE i.is_active
       AND i.min_stock IS NOT NULL
       AND i.min_stock > 0
       AND COALESCE(rs.qty, 0) <= i.min_stock;
  END IF;

  RETURN jsonb_build_object(
    'diajukan',  v_diajukan,
    'aktif',     v_aktif,
    'sisa',      v_sisa,
    'low_stock', v_low_stock
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_nav_queue_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_nav_queue_counts() TO authenticated;

-- 14b. Dead Stock server-side: pakai transaction_date & transaksi keluar nyata
--      (type = 'out', status = 'posted'), bebas limit 1.000 baris PostgREST!
CREATE OR REPLACE FUNCTION public.get_dead_stock(p_days integer DEFAULT 90)
RETURNS TABLE (
  item_id        uuid,
  sku            text,
  name           text,
  brand          text,
  total_stock    numeric,
  purchase_price numeric,
  stock_value    numeric,
  last_out_date  date,
  days_idle      integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_today date := public.today_wib();
  v_days  integer := GREATEST(COALESCE(p_days, 90), 1);
BEGIN
  IF NOT public.has_permission('inventory.view') THEN
    RAISE EXCEPTION 'Tidak punya izin melihat data persediaan';
  END IF;

  RETURN QUERY
  WITH bal AS (
    SELECT b.item_id, COALESCE(SUM(b.qty), 0) AS total_stock
      FROM public.inventory_balances b
     GROUP BY b.item_id
    HAVING COALESCE(SUM(b.qty), 0) > 0
  ),
  last_out AS (
    SELECT ld.item_id, MAX(t.transaction_date) AS last_date
      FROM public.inventory_ledger ld
      JOIN public.inventory_transactions t ON t.id = ld.transaction_id
     WHERE ld.qty_change < 0
       AND t.type = 'out'
       AND t.status = 'posted'
     GROUP BY ld.item_id
  )
  SELECT
    i.id,
    i.sku,
    i.name,
    i.brand,
    b.total_stock::numeric,
    COALESCE(i.purchase_price, 0)::numeric,
    (b.total_stock * COALESCE(i.purchase_price, 0))::numeric,
    lo.last_date,
    CASE WHEN lo.last_date IS NOT NULL THEN (v_today - lo.last_date)::integer ELSE NULL END
    FROM public.inventory_items i
    JOIN bal b ON b.item_id = i.id
    LEFT JOIN last_out lo ON lo.item_id = i.id
   WHERE i.is_active
     AND (lo.last_date IS NULL OR (v_today - lo.last_date) >= v_days)
   ORDER BY
     CASE WHEN lo.last_date IS NULL THEN 999999 ELSE (v_today - lo.last_date) END DESC,
     (b.total_stock * COALESCE(i.purchase_price, 0)) DESC,
     i.name;
END;
$$;
REVOKE ALL ON FUNCTION public.get_dead_stock(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dead_stock(integer) TO authenticated;

-- 14c. Advisory lock untuk Edge Function sync-sheets (cegah double-run bersamaan)
CREATE OR REPLACE FUNCTION public.try_lock_sheet_sync(p_lock_key text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT pg_try_advisory_lock(hashtext('sheet_sync:' || COALESCE(p_lock_key, 'default')));
$$;
REVOKE ALL ON FUNCTION public.try_lock_sheet_sync(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_lock_sheet_sync(text) TO service_role;

CREATE OR REPLACE FUNCTION public.unlock_sheet_sync(p_lock_key text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT pg_advisory_unlock(hashtext('sheet_sync:' || COALESCE(p_lock_key, 'default')));
$$;
REVOKE ALL ON FUNCTION public.unlock_sheet_sync(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unlock_sheet_sync(text) TO service_role;
