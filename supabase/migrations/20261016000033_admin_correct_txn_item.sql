-- 20261016000033_admin_correct_txn_item.sql
-- Fitur koreksi manual jenis stok di Log Transaksi (khusus super_admin).
-- Masalah: beberapa transaksi tercatat dengan jenis stok / lokasi yang salah
-- (mis. tiket A2610140956: diminta ASSET RETUR tetapi tercatat & terpotong
-- dari STOK-BARU). Fungsi ini memperbaiki label sekaligus memindahkan stok
-- antar lokasi agar saldo benar, dengan jejak audit berupa transaksi transfer.
--
-- Cara kerja:
--   OUT: stok dulu dikurangi dari lokasi_lama (salah) → seharusnya dari lokasi_baru.
--        Koreksi = transfer (lokasi_baru -> lokasi_lama) sebesar qty.
--   IN : stok dulu ditambah ke lokasi_lama (salah) → seharusnya ke lokasi_baru.
--        Koreksi = transfer (lokasi_lama -> lokasi_baru) sebesar qty.
-- Idempoten untuk label: bila status sudah benar, tidak ada transfer baru.

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
  v_txn      record;
  v_tii      record;
  v_norm     text;
  v_new_loc  uuid;
  v_old_loc  uuid;
  v_from_loc uuid;
  v_to_loc   uuid;
  v_corr_id  uuid;
  v_doc      text;
  v_moved    boolean := false;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Hanya super admin yang boleh mengoreksi log transaksi';
  END IF;

  v_norm := CASE
    WHEN upper(COALESCE(p_new_status_aset, '')) LIKE '%UNREADY%' THEN 'UNREADY'
    WHEN upper(COALESCE(p_new_status_aset, '')) LIKE '%RETUR%'   THEN 'ASSET RETUR'
    ELSE 'ASSET BARU'
  END;

  SELECT * INTO v_txn FROM public.inventory_transactions WHERE id = p_transaction_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaksi tidak ditemukan';
  END IF;
  IF v_txn.status <> 'posted' THEN
    RAISE EXCEPTION 'Hanya transaksi posted yang bisa dikoreksi (status: %)', v_txn.status;
  END IF;
  IF v_txn.type NOT IN ('in', 'out') THEN
    RAISE EXCEPTION 'Koreksi jenis stok hanya untuk transaksi masuk/keluar (tipe: %)', v_txn.type;
  END IF;

  SELECT * INTO v_tii FROM public.inventory_transaction_items
   WHERE transaction_id = p_transaction_id AND item_id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item transaksi tidak ditemukan';
  END IF;

  -- Lokasi asal stok pada transaksi ini.
  v_old_loc := CASE
    WHEN v_txn.type = 'out' THEN v_txn.source_location_id
    ELSE v_txn.dest_location_id
  END;

  SELECT id INTO v_new_loc FROM public.locations
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

  -- Label sudah benar → tidak ada yang dikerjakan (idempoten).
  IF v_tii.status_aset = v_norm AND v_new_loc = v_old_loc THEN
    RETURN jsonb_build_object(
      'moved', false, 'doc', NULL,
      'old_status', v_tii.status_aset, 'new_status', v_norm,
      'note', 'Tidak ada perubahan'
    );
  END IF;

  IF v_new_loc <> v_old_loc THEN
    IF v_txn.type = 'out' THEN
      -- Salah kurangi old_loc → harusnya kurangi new_loc.
      v_from_loc := v_new_loc;
      v_to_loc   := v_old_loc;
    ELSE
      -- Salah tambah ke old_loc → harusnya tambah ke new_loc.
      v_from_loc := v_old_loc;
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

    -- allow_negative=true: koreksi admin boleh menutup selisih walau lokasi
    -- tujuan tercatat minus (menandakan ada penerimaan yang belum dicatat).
    PERFORM public._apply_posted_effects(v_corr_id, true);
    v_moved := true;

    SELECT doc_number INTO v_doc FROM public.inventory_transactions WHERE id = v_corr_id;
  END IF;

  UPDATE public.inventory_transaction_items
     SET status_aset = v_norm,
         updated_at  = now()
   WHERE transaction_id = p_transaction_id AND item_id = p_item_id;

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
