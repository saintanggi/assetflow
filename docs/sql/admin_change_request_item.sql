-- 20261019000037_admin_change_request_item.sql
--
-- BUG: mengubah BARANG (atau Status Aset) pada baris permintaan yang SUDAH
-- dikirim hanya meng-update tabel request_items. Transaksi OUT yang sudah
-- posted dan saldo stok tidak ikut berubah, sehingga:
--   - barang LAMA tetap menyimpan potongan stok (contoh: MONITOR SET -4 di
--     STOK-RETUR), walaupun tiketnya sudah diganti menjadi MONITOR;
--   - barang BARU tidak pernah terpotong, jadi saldonya terlalu besar.
--
-- FIX: koreksi dijalankan sebagai satu operasi atomik:
--   1. stok qty_terkirim dikembalikan ke barang LAMA di lokasi pemotong lama;
--   2. stok qty_terkirim dipotong dari barang BARU di lokasi pemotong baru;
--   3. request_items.item_id / status_aset diperbarui.
-- Jejak audit dibuat sebagai dua transaksi posted (IN + OUT) bernomor dokumen,
-- sehingga terlihat di Log Transaksi dan bisa ditelusuri (history lama tetap
-- utuh, tidak ada baris yang dihapus).
--
-- Idempoten: kunci idempotency dibentuk dari parameter, jadi klik ganda tidak
-- menggandakan perpindahan stok.
--
-- Aman dijalankan berulang (CREATE OR REPLACE), tidak mengubah data lama.

-- ---------------------------------------------------------------------------
-- 1. Helper: pindahkan qty dari (barang A di lokasi X) ke (barang B di lokasi Y)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_move_stock_between_items(
  p_from_item_id     uuid,
  p_from_location_id uuid,
  p_to_item_id       uuid,
  p_to_location_id   uuid,
  p_qty              numeric,
  p_reason           text DEFAULT NULL,
  p_reference        text DEFAULT NULL
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

  -- Sama-sama sama: tidak ada yang perlu dipindahkan.
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

  v_key := 'KOREKSI-ITEM/' || p_from_item_id::text || '/' || p_from_location_id::text
           || '/' || p_to_item_id::text || '/' || p_to_location_id::text
           || '/' || p_qty::text;

  -- 1) Kembalikan stok ke barang lama di lokasi lama (IN).
  SELECT id, doc_number INTO v_in_txn, v_in_doc
    FROM public.inventory_transactions
   WHERE idempotency_key = v_key || '/IN';
  IF v_in_txn IS NULL THEN
    INSERT INTO public.inventory_transactions (
      type, status, transaction_date, dest_location_id, notes, reference,
      idempotency_key, created_by, posted_at
    ) VALUES (
      'in', 'posted', CURRENT_DATE, p_from_location_id, v_notes,
      COALESCE(p_reference, 'KOREKSI-ITEM'), v_key || '/IN', auth.uid(), now()
    )
    RETURNING id, doc_number INTO v_in_txn, v_in_doc;

    INSERT INTO public.inventory_transaction_items (transaction_id, item_id, qty, notes)
    VALUES (v_in_txn, p_from_item_id, p_qty, 'Pengembalian stok: barang permintaan diganti');

    -- allow_negative = true: koreksi admin tidak boleh terblokir guard stok.
    PERFORM public._apply_posted_effects(v_in_txn, true);
    v_in_done := true;
  END IF;

  -- 2) Potong stok dari barang baru di lokasi baru (OUT).
  SELECT id, doc_number INTO v_out_txn, v_out_doc
    FROM public.inventory_transactions
   WHERE idempotency_key = v_key || '/OUT';
  IF v_out_txn IS NULL THEN
    INSERT INTO public.inventory_transactions (
      type, status, transaction_date, source_location_id, notes, reference,
      idempotency_key, created_by, posted_at
    ) VALUES (
      'out', 'posted', CURRENT_DATE, p_to_location_id, v_notes,
      COALESCE(p_reference, 'KOREKSI-ITEM'), v_key || '/OUT', auth.uid(), now()
    )
    RETURNING id, doc_number INTO v_out_txn, v_out_doc;

    INSERT INTO public.inventory_transaction_items (transaction_id, item_id, qty, notes)
    VALUES (v_out_txn, p_to_item_id, p_qty, 'Pemotongan stok: barang permintaan baru');

    PERFORM public._apply_posted_effects(v_out_txn, true);
    v_out_done := true;
  END IF;

  RETURN jsonb_build_object(
    'moved',        v_in_done OR v_out_done,
    'qty',          p_qty,
    'from_item',    v_from_name,
    'to_item',      v_to_name,
    'from_location', v_from_loc,
    'to_location',  v_to_loc,
    'in_doc',       v_in_doc,
    'out_doc',      v_out_doc
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_move_stock_between_items(uuid, uuid, uuid, uuid, numeric, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_move_stock_between_items(uuid, uuid, uuid, uuid, numeric, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. RPC: ubah barang / Status Aset pada satu baris permintaan + pindahkan stok
-- ---------------------------------------------------------------------------
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

  -- Normalisasi Status Aset memakai aturan yang sama dengan ship_request_items.
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

  -- Stok hanya perlu dipindah bila baris ini sudah pernah dikirim.
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

    v_move := public.admin_move_stock_between_items(
      v_ri.item_id, v_old_loc,
      v_new_item,   v_new_loc,
      v_qty,
      COALESCE(
        NULLIF(btrim(COALESCE(p_reason, '')), ''),
        'Ubah barang pada permintaan ' || COALESCE(v_ticket, v_req_number, v_ri.request_id::text)
      ),
      'KOREKSI-ITEM/' || COALESCE(v_req_number, v_ri.request_id::text)
    );
  END IF;

  UPDATE public.request_items
     SET item_id    = v_new_item,
         status_aset = v_new_status,
         updated_at = now()
   WHERE id = p_request_item_id;

  RETURN jsonb_build_object(
    'ok',            true,
    'request_number', v_req_number,
    'qty_shipped',   v_qty,
    'old_item_id',   v_ri.item_id,
    'new_item_id',   v_new_item,
    'old_status',    v_old_status,
    'new_status',    v_new_status,
    'stock_move',    v_move
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_change_request_item(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_change_request_item(uuid, uuid, text, text) TO authenticated;
