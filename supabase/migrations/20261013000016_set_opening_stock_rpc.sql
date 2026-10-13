-- 20261013000016 — RPC untuk set stok awal langsung (superadmin).
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
  IF NOT (public.has_permission('inventory.manage')) THEN
    RAISE EXCEPTION 'Tidak punya izin mengatur stok awal';
  END IF;
  IF p_qty < 0 THEN
    RAISE EXCEPTION 'Stok awal tidak boleh negatif';
  END IF;

  INSERT INTO public.inventory_balances (item_id, location_id, qty, opening_qty)
  VALUES (p_item_id, p_location_id, p_qty, p_qty)
  ON CONFLICT (item_id, location_id)
  DO UPDATE SET qty = EXCLUDED.qty, opening_qty = EXCLUDED.opening_qty, updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.set_opening_stock(uuid, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_opening_stock(uuid, uuid, numeric) TO authenticated;
