-- 20261106000001 — RPC hapus master barang (khusus super admin).
-- Request Anggi 6 Nov 2026: tombol hapus di Master Barang, khusus super admin.
-- Pengaman: hanya barang TANPA stok (semua saldo 0) dan TANPA riwayat
-- pemakaian (permintaan, log transaksi, PO, opname, label) yang bisa dihapus.
-- Barang yang masih ada stok / sudah dipakai ditolak dengan pesan yang
-- menyebut nama barang + alasan penolakan (bukan kode error).
CREATE OR REPLACE FUNCTION public.delete_inventory_item(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_sku text;
  v_name text;
  v_stock numeric(15,3);
  v_req int;
  v_ledger int;
  v_txn int;
  v_po int;
  v_opname int;
  v_label int;
  v_parts text[] := '{}';
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Hanya super admin yang bisa menghapus master barang';
  END IF;

  SELECT sku, name INTO v_sku, v_name
    FROM public.inventory_items WHERE id = p_item_id;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Barang tidak ditemukan';
  END IF;

  -- Stok harus nol di semua lokasi (nilai mutlak, supaya +5/-5 tidak lolos).
  SELECT COALESCE(SUM(ABS(qty)), 0) INTO v_stock
    FROM public.inventory_balances WHERE item_id = p_item_id;
  IF v_stock > 0 THEN
    RAISE EXCEPTION 'Tidak bisa dihapus: % (%) masih ada stok % — nol-kan dulu lewat Atur Stok',
      v_name, COALESCE(v_sku, '-'), v_stock;
  END IF;

  -- Riwayat pemakaian di tabel lain (FK RESTRICT semua — dicek dulu supaya
  -- pesannya jelas, bukan error constraint).
  SELECT COUNT(*) INTO v_req FROM public.request_items WHERE item_id = p_item_id;
  SELECT COUNT(*) INTO v_ledger FROM public.inventory_ledger WHERE item_id = p_item_id;
  SELECT COUNT(*) INTO v_txn FROM public.inventory_transaction_items WHERE item_id = p_item_id;
  SELECT COUNT(*) INTO v_po FROM public.purchase_order_items WHERE item_id = p_item_id;
  SELECT COUNT(*) INTO v_opname FROM public.stock_count_items WHERE item_id = p_item_id;
  SELECT COUNT(*) INTO v_label FROM public.qr_label_batches WHERE item_id = p_item_id;

  IF v_req > 0 THEN v_parts := v_parts || (v_req || ' permintaan'); END IF;
  IF v_ledger > 0 THEN v_parts := v_parts || (v_ledger || ' log transaksi'); END IF;
  IF v_txn > 0 THEN v_parts := v_parts || (v_txn || ' baris transaksi'); END IF;
  IF v_po > 0 THEN v_parts := v_parts || (v_po || ' baris PO'); END IF;
  IF v_opname > 0 THEN v_parts := v_parts || (v_opname || ' baris opname'); END IF;
  IF v_label > 0 THEN v_parts := v_parts || (v_label || ' label'); END IF;
  IF array_length(v_parts, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Tidak bisa dihapus: % (%) sudah dipakai (%). Nonaktifkan saja lewat kolom Aktif.',
      v_name, COALESCE(v_sku, '-'), array_to_string(v_parts, ', ');
  END IF;

  -- Saldo nol dihapus dulu (RESTRICT), baru barangnya.
  DELETE FROM public.inventory_balances WHERE item_id = p_item_id;
  DELETE FROM public.inventory_items WHERE id = p_item_id;

  RETURN jsonb_build_object('deleted', true, 'sku', v_sku, 'name', v_name);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_inventory_item(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_inventory_item(uuid) TO authenticated;
