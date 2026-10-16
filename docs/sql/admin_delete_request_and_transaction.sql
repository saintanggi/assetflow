-- 20261016000035 — Hapus transaksi/permintaan khusus Super Admin tanpa menyisakan
-- IN/OUT di inventory_ledger dan pulihkan saldo bersihnya.
--
-- Menghapus ledger effect dilakukan dengan mengurangi saldo saat ini sebesar
-- net qty_change dari baris ledger yang dihapus (bukan membuat transaksi balik).
-- Jika request dihapus, seluruh transaksi REQ-KIRIM, reversal, dan koreksi admin
-- yang terkait ikut dihapus. Trigger membuat penghapusan melalui UI/REST tetap aman.

CREATE OR REPLACE FUNCTION public._admin_purge_inventory_transactions(p_root_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_target_ids    uuid[];
  v_expected      integer;
  v_deleted       integer;
  v_ledger_deleted integer := 0;
  v_total         integer := 0;
BEGIN
  IF NOT (public.is_super_admin() OR public.is_service_role()) THEN
    RAISE EXCEPTION 'Hanya Super Admin yang boleh menghapus histori transaksi';
  END IF;

  -- Tutup semua ketergantungan: reversal (FK reversal_of) dan koreksi manual
  -- (reference KOREKSI-ADMIN/<transaction_id>), termasuk rantai lanjutannya.
  WITH RECURSIVE related(id) AS (
    SELECT unnest(COALESCE(p_root_ids, ARRAY[]::uuid[]))
    UNION
    SELECT child.id
      FROM public.inventory_transactions child
      JOIN related parent
        ON child.reversal_of = parent.id
        OR child.reference = 'KOREKSI-ADMIN/' || parent.id::text
  )
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
    INTO v_target_ids
    FROM related;

  v_expected := cardinality(v_target_ids);
  IF v_expected = 0 THEN
    RETURN jsonb_build_object('transactions_deleted', 0, 'ledger_rows_deleted', 0);
  END IF;

  -- Kunci transaksi target sebelum membaca net efek ledger.
  PERFORM t.id
    FROM public.inventory_transactions t
   WHERE t.id = ANY(v_target_ids)
   ORDER BY t.id
   FOR UPDATE;

  -- Pulihkan saldo bersih tanpa membuat transaksi IN/OUT atau ledger baru.
  -- Jika stok dari pengiriman ini sudah terpakai di transaksi berikutnya,
  -- selisih yang dihapus dapat membuat saldo lokasi menjadi negatif.
  INSERT INTO public.inventory_balances (item_id, location_id, qty)
  SELECT item_id, location_id, -SUM(qty_change)
    FROM public.inventory_ledger
   WHERE transaction_id = ANY(v_target_ids)
   GROUP BY item_id, location_id
  ON CONFLICT (item_id, location_id)
  DO UPDATE SET qty = public.inventory_balances.qty + EXCLUDED.qty,
                updated_at = now();

  DELETE FROM public.inventory_ledger
   WHERE transaction_id = ANY(v_target_ids);
  GET DIAGNOSTICS v_ledger_deleted = ROW_COUNT;

  -- Hapus daun terlebih dahulu agar FK reversal_of yang RESTRICT tetap aman.
  LOOP
    DELETE FROM public.inventory_transactions t
     WHERE t.id = ANY(v_target_ids)
       AND NOT EXISTS (
         SELECT 1
           FROM public.inventory_transactions child
          WHERE child.reversal_of = t.id
       );
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_total := v_total + v_deleted;
    EXIT WHEN v_deleted = 0;
  END LOOP;

  IF v_total <> v_expected THEN
    RAISE EXCEPTION
      'Penghapusan dibatalkan: hanya % dari % transaksi dapat dihapus karena masih terhubung ke transaksi di luar kelompok',
      v_total, v_expected;
  END IF;

  RETURN jsonb_build_object(
    'transactions_deleted', v_total,
    'ledger_rows_deleted', v_ledger_deleted
  );
END;
$$;
REVOKE ALL ON FUNCTION public._admin_purge_inventory_transactions(uuid[]) FROM PUBLIC, anon, authenticated;

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
    SELECT 1 FROM ancestors WHERE reference LIKE 'REQ-KIRIM/%'
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

  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
    INTO v_roots
    FROM public.inventory_transactions
   WHERE reference = 'REQ-KIRIM/' || OLD.request_number;

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
