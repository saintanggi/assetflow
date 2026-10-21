-- 20261021000039 — Hapus SATU baris item permintaan khusus Super Admin.
--
-- Kebutuhan: tiket yang sudah Selesai ternyata punya baris salah input
-- (mis / batal kirim), sehingga baris itu harus dibuang dari daftar Item
-- Permintaan. Sebelumnya tidak ada jalur aman: menghapus request_items
-- langsung tidak mengembalikan stok yang sudah terpotong, dan policy
-- request_items_all (FOR ALL) bahkan mengizinkan role lain ikut menghapus.
--
-- Perlakuan stok (konsisten dengan admin_change_request_item):
--   * qty_shipped = 0  -> hapus baris saja, tanpa transaksi.
--   * qty_shipped > 0  -> buat SATU transaksi 'in' (posted) yang
--     mengembalikan qty tersebut ke lokasi Status Aset
--     (STOK-BARU / STOK-RETUR / STOK-UNREADY), reference HAPUS-ITEM/<no>,
--     idempotency HAPUS-ITEM/<request_item_id> (klik ganda aman).
--     Riwayat OUT lama tetap utuh — Log Transaksi menampilkan OUT + IN koreksi.
--
-- Konsistensi dengan hapus permintaan utuh (migrasi 20261016000035):
--   * trigger purge kini mengumpulkan reference REQ-KIRIM/<no> DAN
--     HAPUS-ITEM/<no>, supaya penghapusan seluruh tiket tidak mengembalikan
--     stok dua kali (OUT dipulihkan -5, IN koreksi +2 ikut terkumpul -> net +3).
--   * admin_delete_inventory_transaction ikut memblokir HAPUS-ITEM/% agar
--     transaksi koreksi tidak bisa dihapus lewat Log Transaksi.
--
-- Status header: hanya status aktif (disetujui/disetujui_sebagian/diproses/
-- selesai) dihitung ulang — semua sisa baris terkirim/ditolak -> selesai;
-- ada pending/menunggu_stok -> disetujui_sebagian; selain itu dibiarkan.
-- Baris terakhir tidak bisa dihapus (arahkan ke hapus seluruh permintaan).
--
-- Aman dijalankan ulang (CREATE OR REPLACE / DROP POLICY IF EXISTS).

-- ---------------------------------------------------------------- 1. RPC
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

  -- Baris terakhir: arahkan ke hapus seluruh permintaan agar daftar tidak
  -- menyisakan tiket kosong.
  SELECT count(*) INTO v_remaining
    FROM public.request_items
   WHERE request_id = v_ri.request_id
     AND id <> v_ri.id;

  IF v_remaining = 0 THEN
    RAISE EXCEPTION 'Ini baris terakhir permintaan. Untuk membuang seluruh tiket, hapus permintaannya dari menu Permintaan.';
  END IF;

  v_qty := COALESCE(v_ri.qty_shipped, 0);
  v_doc := NULL;

  -- Sudah terkirim: kembalikan stok dulu (transaksi IN koreksi), baru hapus baris.
  IF v_qty > 0 THEN
    v_norm := CASE
      WHEN upper(COALESCE(v_ri.status_aset, '')) LIKE '%UNREADY%' THEN 'UNREADY'
      WHEN upper(COALESCE(v_ri.status_aset, '')) LIKE '%RETUR%'   THEN 'ASSET RETUR'
      ELSE 'ASSET BARU'
    END;
    v_loc_code := CASE v_norm
      WHEN 'UNREADY'    THEN 'STOK-UNREADY'
      WHEN 'ASSET RETUR' THEN 'STOK-RETUR'
      ELSE 'STOK-BARU'
    END;

    -- Lokasi kategori wajib ada (tanpa fallback), sama seperti ship RPC.
    SELECT id INTO v_loc_id
      FROM public.locations
     WHERE code = v_loc_code
       AND is_active
     LIMIT 1;

    IF v_loc_id IS NULL THEN
      RAISE EXCEPTION 'Lokasi stok % tidak ditemukan — pengembalian stok dibatalkan', v_loc_code;
    END IF;

    -- Idempotensi: klik ganda / retry tidak menggandakan pengembalian.
    SELECT id, doc_number INTO v_txn_id, v_doc
      FROM public.inventory_transactions
     WHERE idempotency_key = 'HAPUS-ITEM/' || p_request_item_id::text;

    IF v_txn_id IS NULL THEN
      INSERT INTO public.inventory_transactions (
        type, status, transaction_date, dest_location_id, notes, reference,
        idempotency_key, created_by, posted_at
      ) VALUES (
        'in', 'posted', CURRENT_DATE, v_loc_id,
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

      -- allow_negative = true: koreksi admin tidak boleh terblokir guard stok.
      PERFORM public._apply_posted_effects(v_txn_id, true);
    END IF;
  END IF;

  DELETE FROM public.request_items
   WHERE id = p_request_item_id;

  -- Hitung ulang status header HANYA untuk status aktif; status diajukan /
  -- ditolak tidak diubah oleh penghapusan baris.
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
    'ok',            true,
    'qty_restored',  v_qty,
    'in_doc',        v_doc,
    'request_number', v_req_number,
    'status',        COALESCE(v_new_status, v_req_status)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_delete_request_item(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_request_item(uuid, text) TO authenticated;

-- ------------------------------------------- 2. Guard hapus transaksi tunggal
-- Transaksi HAPUS-ITEM/% harus ikut terhapus bersama permintaannya, bukan
-- lewat Log Transaksi (kalau tidak, pemulihan stok menjadi tidak simetris
-- saat tiket dihapus kemudian).
CREATE OR REPLACE FUNCTION public.admin_delete_inventory_transaction(p_transaction_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_reference text;
  v_related_request boolean;
  v_result jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Hanya Super Admin yang boleh menghapus transaksi';
  END IF;

  SELECT reference INTO v_reference
    FROM public.inventory_transactions
   WHERE id = p_transaction_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaksi tidak ditemukan';
  END IF;

  -- Transaksi pengiriman permintaan (termasuk koreksi/reversal-nya) hanya boleh
  -- dibersihkan bersama permintaannya supaya qty_shipped tetap konsisten.
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
  ) INTO v_related_request;

  IF v_related_request THEN
    RAISE EXCEPTION 'Transaksi pengiriman permintaan harus dihapus melalui daftar Permintaan agar stok dan detail permintaan tetap konsisten';
  END IF;

  v_result := public._admin_purge_inventory_transactions(ARRAY[p_transaction_id]);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_delete_inventory_transaction(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_inventory_transaction(uuid) TO authenticated;

-- ------------------------------------- 3. Purge trigger: kumpulkan HAPUS-ITEM
CREATE OR REPLACE FUNCTION public.purge_request_inventory_history_before_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_roots uuid[];
BEGIN
  IF NOT (public.is_super_admin() OR public.is_service_role()) THEN
    RAISE EXCEPTION 'Hanya Super Admin yang boleh menghapus permintaan';
  END IF;

  -- REQ-KIRIM = OUT pengiriman; HAPUS-ITEM = IN koreksi pengembalian baris
  -- yang pernah dihapus. Keduanya dihitung bersih supaya saldo kembali tepat
  -- ke keadaan sebelum tiket ada (tanpa pengembalian ganda).
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
    INTO v_roots
    FROM public.inventory_transactions
   WHERE reference IN ('REQ-KIRIM/' || OLD.request_number,
                       'HAPUS-ITEM/' || OLD.request_number);

  PERFORM public._admin_purge_inventory_transactions(v_roots);
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.purge_request_inventory_history_before_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_purge_request_inventory_history ON public.requests;
CREATE TRIGGER trg_purge_request_inventory_history
  BEFORE DELETE ON public.requests
  FOR EACH ROW
  EXECUTE FUNCTION public.purge_request_inventory_history_before_delete();

-- ------------------------------------------------- 4. RLS: DELETE hanya Super
-- Admin
-- Policy lama request_items_all (FOR ALL) memberi izin DELETE pada role
-- requests.create / requests.review / requests.process. UI hapus hanya untuk
-- Super Admin, jadi DELETE dibatasi is_super_admin() — SELECT/INSERT/UPDATE
-- tetap persis seperti perilaku lama (policy FOR ALL lama juga menaungi
-- SELECT, jadi disimpan sebagai policy terpisah agar cakupannya tidak berubah).
DROP POLICY IF EXISTS request_items_all ON public.request_items;
DROP POLICY IF EXISTS request_items_ins ON public.request_items;
DROP POLICY IF EXISTS request_items_upd ON public.request_items;
DROP POLICY IF EXISTS request_items_read ON public.request_items;
DROP POLICY IF EXISTS request_items_delete ON public.request_items;

CREATE POLICY request_items_ins ON public.request_items
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission('requests.create')
    OR public.has_permission('requests.review')
    OR public.has_permission('requests.process')
  );

CREATE POLICY request_items_upd ON public.request_items
  FOR UPDATE TO authenticated
  USING (
    public.has_permission('requests.create')
    OR public.has_permission('requests.review')
    OR public.has_permission('requests.process')
  )
  WITH CHECK (
    public.has_permission('requests.create')
    OR public.has_permission('requests.review')
    OR public.has_permission('requests.process')
  );

CREATE POLICY request_items_read ON public.request_items
  FOR SELECT TO authenticated
  USING (
    public.has_permission('requests.create')
    OR public.has_permission('requests.review')
    OR public.has_permission('requests.process')
  );

CREATE POLICY request_items_delete ON public.request_items
  FOR DELETE TO authenticated
  USING (public.is_super_admin());
