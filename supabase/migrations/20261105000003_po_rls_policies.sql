-- 20261105000003 — RLS policy untuk modul Purchase Order.
--
-- BUG: migrasi 20261105000002 mengaktifkan RLS di purchase_orders &
-- purchase_order_items TANPA policy apa pun → semua akses ditolak
-- (halaman PO tidak bisa baca/tulis data). Perbaikan: policy mengikuti
-- pola inventory_items — baca pakai inventory.view, tulis pakai
-- inventory.receive, DELETE ditolak (tidak ada kebijakan).

CREATE POLICY purchase_orders_select ON public.purchase_orders
  FOR SELECT TO authenticated USING (public.has_permission('inventory.view'));
CREATE POLICY purchase_orders_insert ON public.purchase_orders
  FOR INSERT TO authenticated WITH CHECK (public.has_permission('inventory.receive'));
CREATE POLICY purchase_orders_update ON public.purchase_orders
  FOR UPDATE TO authenticated
  USING (public.has_permission('inventory.receive'))
  WITH CHECK (public.has_permission('inventory.receive'));

CREATE POLICY purchase_order_items_select ON public.purchase_order_items
  FOR SELECT TO authenticated USING (public.has_permission('inventory.view'));
CREATE POLICY purchase_order_items_insert ON public.purchase_order_items
  FOR INSERT TO authenticated WITH CHECK (public.has_permission('inventory.receive'));
CREATE POLICY purchase_order_items_update ON public.purchase_order_items
  FOR UPDATE TO authenticated
  USING (public.has_permission('inventory.receive'))
  WITH CHECK (public.has_permission('inventory.receive'));
