-- 20261102000002 — RPC hapus log transaksi + kembalikan stok (void).
-- Request Anggi 2 Nov 2026: "buatkan menu untuk hapus log transaksi, dan ketika dihapus lognya stoknya kembali ke awal".
CREATE OR REPLACE FUNCTION public.void_inventory_transaction(p_transaction_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  r RECORD;
  v_doc text;
  v_count int := 0;
  v_new_qty numeric(15,3);
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Hanya super admin yang bisa menghapus log transaksi';
  END IF;

  SELECT doc_number INTO v_doc FROM public.inventory_transactions WHERE id = p_transaction_id;
  IF v_doc IS NULL THEN
    RAISE EXCEPTION 'Transaksi tidak ditemukan';
  END IF;

  -- Balikkan setiap pergerakan ledger: qty = qty - qty_change.
  -- Cek agar tidak negatif (transaksi lain mungkin sudah memakai stoknya).
  FOR r IN
    SELECT item_id, location_id, qty_change
      FROM public.inventory_ledger
     WHERE transaction_id = p_transaction_id
  LOOP
    SELECT qty - r.qty_change INTO v_new_qty
      FROM public.inventory_balances
     WHERE item_id = r.item_id AND location_id = r.location_id;

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

  -- Hapus jejak transaksi (ledger dulu karena RESTRICT).
  DELETE FROM public.inventory_ledger WHERE transaction_id = p_transaction_id;
  DELETE FROM public.inventory_transaction_items WHERE transaction_id = p_transaction_id;
  DELETE FROM public.inventory_transactions WHERE id = p_transaction_id;

  RETURN jsonb_build_object('deleted', true, 'doc', v_doc, 'ledger_rows', v_count);
END;
$$;
REVOKE ALL ON FUNCTION public.void_inventory_transaction(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_inventory_transaction(uuid) TO authenticated;
