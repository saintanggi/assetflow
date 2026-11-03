-- 20261102000001 — set_opening_stock: set qty langsung = p_qty (tidak tambah riwayat ledger).
-- Request Anggi 2 Nov 2026: "ketika ganti stok awal tidak usah bertambah dan tidak usah pakai log transaksi".
CREATE OR REPLACE FUNCTION public.set_opening_stock(
  p_item_id     uuid,
  p_location_id uuid,
  p_qty         numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT (
    public.has_permission('inventory.manage')
    OR public.has_permission('inventory.adjust')
    OR public.is_super_admin()
  ) THEN
    RAISE EXCEPTION 'Tidak punya izin mengatur stok awal';
  END IF;
  IF p_qty < 0 THEN
    RAISE EXCEPTION 'Stok awal tidak boleh negatif';
  END IF;

  -- Set langsung: qty = opening_qty = p_qty. Tidak tambah net movement ledger,
  -- tidak tulis ke inventory_ledger (tidak muncul di Log Transaksi).
  INSERT INTO public.inventory_balances (item_id, location_id, qty, opening_qty)
  VALUES (p_item_id, p_location_id, p_qty, p_qty)
  ON CONFLICT (item_id, location_id)
  DO UPDATE SET
    opening_qty = EXCLUDED.opening_qty,
    qty         = EXCLUDED.qty,
    updated_at  = now();
END;
$$;
REVOKE ALL ON FUNCTION public.set_opening_stock(uuid, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_opening_stock(uuid, uuid, numeric) TO authenticated;
