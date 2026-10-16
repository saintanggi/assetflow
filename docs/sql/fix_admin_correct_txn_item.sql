-- 20261016000036 — Perbaiki koreksi Status Aset di Log Transaksi.
--
-- Sebelumnya UI memprioritaskan status_aset di request_items saat membaca log,
-- sehingga perubahan pada inventory_transaction_items tidak terlihat setelah
-- reload. Fungsi koreksi juga selalu membandingkan lokasi baru dengan source
-- transaksi asal; koreksi berulang dapat membuat transfer stok ganda.
--
-- Versi ini memakai lokasi efektif terakhir dari transfer KOREKSI-ADMIN untuk
-- koreksi berikutnya dan idempoten jika jenis/lokasi sudah sesuai.

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

  -- Untuk transaksi yang pernah dikoreksi, sumber/tujuan efektif adalah kategori
  -- terakhir yang sudah dikoreksi, bukan selalu lokasi transaksi asal.
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

  -- Idempoten: jangan menambah transfer bila transaksi sudah mewakili kondisi
  -- yang diminta dan baris aset sudah memiliki label tersebut.
  IF v_tii.status_aset = v_norm AND v_effective_loc = v_new_loc THEN
    RETURN jsonb_build_object(
      'moved', false, 'doc', NULL,
      'old_status', v_tii.status_aset, 'new_status', v_norm,
      'note', 'Tidak ada perubahan'
    );
  END IF;

  IF v_new_loc <> v_effective_loc THEN
    IF v_txn.type = 'out' THEN
      -- Kaki debit dipindah dari kategori lama yang efektif ke kategori baru.
      v_from_loc := v_new_loc;
      v_to_loc   := v_effective_loc;
    ELSE
      -- Kaki kredit dipindah dari kategori lama yang efektif ke kategori baru.
      v_from_loc := v_effective_loc;
      v_to_loc   := v_new_loc;
    END IF;

    INSERT INTO public.inventory_transactions (
      type, status, transaction_date,
      source_location_id, dest_location_id,
      notes, reference, created_by, posted_at
    )
    VALUES (
      'transfer', 'posted', CURRENT_DATE,
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
      transaction_id, item_id, qty, notes, status_aset
    )
    VALUES (
      v_corr_id, p_item_id, v_tii.qty,
      'Koreksi: ' || COALESCE(v_tii.status_aset, '-') || ' → ' || v_norm,
      v_norm
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
