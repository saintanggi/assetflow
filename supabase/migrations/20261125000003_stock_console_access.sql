-- =============================================================
-- 20261125000003 — Fungsi baca stok bisa diuji dari SQL Editor
-- =============================================================
-- MASALAH
-- stock_period_report() dan stock_integrity() memeriksa
-- has_permission('inventory.view'), yang bergantung pada auth.uid().
-- Di Supabase SQL Editor tidak ada JWT (auth.uid() = NULL), sehingga
-- keduanya selalu melempar "Tidak punya izin melihat stok" walau fungsi
-- sudah terpasang dengan benar. Ini menyulitkan verifikasi manual.
--
-- SOLUSI
-- Tambah _stock_console_read(): true HANYA untuk sesi konsol database
-- (session_user postgres/supabase_admin). Role API (authenticator →
-- anon/authenticated) tetap wajib punya izin inventory.view, karena
-- PostgREST memakai session_user 'authenticator'.
--
-- Fungsi tulis (align_stock_opening_baselines) TIDAK diubah: tetap wajib
-- Super Admin lewat aplikasi, agar jejak audit punya pelaku (auth.uid()).
-- =============================================================

CREATE OR REPLACE FUNCTION public._stock_console_read()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT session_user IN ('postgres', 'supabase_admin')
$$;

REVOKE ALL ON FUNCTION public._stock_console_read() FROM PUBLIC;

-- 1. Laporan stok per periode (selalu rekonsiliasi)
-- -------------------------------------------------------------
-- p_location_ids NULL/array kosong = semua lokasi.
-- p_start > p_end ditolak agar tidak menghasilkan angka menyesatkan.
CREATE OR REPLACE FUNCTION public.stock_period_report(
  p_location_ids uuid[],
  p_start        date,
  p_end          date
)
RETURNS TABLE (
  item_id          uuid,
  location_id      uuid,
  opening_qty      numeric,   -- saldo awal periode
  total_in         numeric,   -- penjumlahan mutasi positif dalam periode
  total_out        numeric,   -- penjumlahan mutasi negatif dalam periode (positif)
  closing_qty      numeric,   -- saldo akhir periode = opening + in - out
  balance_qty      numeric,   -- saldo live saat ini (pembanding)
  opening_baseline numeric,   -- stok awal dasar tersimpan (opening_qty)
  ledger_net       numeric,   -- seluruh mutasi ledger (semua tanggal)
  reconciled       boolean    -- saldo live == stok awal dasar + ledger
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- SQL Editor Supabase berjalan sebagai postgres tanpa JWT, sehingga
  -- auth.uid() NULL dan has_permission() selalu false. Fungsi BACA tetap
  -- diizinkan untuk sesi konsol DB (bukan role API) agar bisa diuji manual.
  IF NOT (public.has_permission('inventory.view') OR public._stock_console_read()) THEN
    RAISE EXCEPTION 'Tidak punya izin melihat stok';
  END IF;
  IF p_start IS NULL OR p_end IS NULL THEN
    RAISE EXCEPTION 'Tanggal awal dan tanggal akhir wajib diisi';
  END IF;
  IF p_start > p_end THEN
    RAISE EXCEPTION 'Tanggal awal tidak boleh setelah tanggal akhir';
  END IF;

  RETURN QUERY
  WITH scope AS (
    SELECT l.id AS loc_id
      FROM public.locations l
     WHERE p_location_ids IS NULL
        OR cardinality(p_location_ids) = 0
        OR l.id = ANY(p_location_ids)
  ),
  moves AS (
    SELECT ld.item_id, ld.location_id, ld.qty_change, t.transaction_date
      FROM public.inventory_ledger ld
      JOIN public.inventory_transactions t ON t.id = ld.transaction_id
      JOIN scope s ON s.loc_id = ld.location_id
  ),
  keys AS (
    SELECT m.item_id, m.location_id FROM moves m
    UNION
    SELECT b.item_id, b.location_id
      FROM public.inventory_balances b
      JOIN scope s ON s.loc_id = b.location_id
  ),
  agg AS (
    SELECT
      k.item_id,
      k.location_id,
      COALESCE(SUM(CASE WHEN m.transaction_date BETWEEN p_start AND p_end
                        THEN m.qty_change END), 0) AS period_net,
      COALESCE(SUM(CASE WHEN m.transaction_date BETWEEN p_start AND p_end
                         AND m.qty_change > 0
                        THEN m.qty_change END), 0) AS tin,
      COALESCE(-SUM(CASE WHEN m.transaction_date BETWEEN p_start AND p_end
                          AND m.qty_change < 0
                         THEN m.qty_change END), 0) AS tout,
      COALESCE(SUM(CASE WHEN m.transaction_date > p_end
                        THEN m.qty_change END), 0) AS after_net,
      COALESCE(SUM(m.qty_change), 0) AS all_net
      FROM keys k
      LEFT JOIN moves m
        ON m.item_id = k.item_id AND m.location_id = k.location_id
     GROUP BY k.item_id, k.location_id
  )
  SELECT
    a.item_id,
    a.location_id,
    (COALESCE(b.qty, 0) - a.after_net - a.period_net)::numeric,
    a.tin::numeric,
    a.tout::numeric,
    (COALESCE(b.qty, 0) - a.after_net)::numeric,
    COALESCE(b.qty, 0)::numeric,
    COALESCE(b.opening_qty, 0)::numeric,
    a.all_net::numeric,
    (ABS(COALESCE(b.opening_qty, 0) + a.all_net - COALESCE(b.qty, 0)) < 0.0005)
    FROM agg a
    LEFT JOIN public.inventory_balances b
      ON b.item_id = a.item_id AND b.location_id = a.location_id;
END;
$$;

REVOKE ALL ON FUNCTION public.stock_period_report(uuid[], date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stock_period_report(uuid[], date, date) TO authenticated;

-- -------------------------------------------------------------
-- 2. Audit integritas: saldo live vs (stok awal dasar + ledger)
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stock_integrity(
  p_location_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  item_id        uuid,
  sku            text,
  item_name      text,
  location_id    uuid,
  location_code  text,
  location_name  text,
  warehouse_name text,
  qty            numeric,
  opening_qty    numeric,
  ledger_net     numeric,
  drift          numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- SQL Editor Supabase berjalan sebagai postgres tanpa JWT, sehingga
  -- auth.uid() NULL dan has_permission() selalu false. Fungsi BACA tetap
  -- diizinkan untuk sesi konsol DB (bukan role API) agar bisa diuji manual.
  IF NOT (public.has_permission('inventory.view') OR public._stock_console_read()) THEN
    RAISE EXCEPTION 'Tidak punya izin melihat stok';
  END IF;

  RETURN QUERY
  SELECT
    b.item_id,
    i.sku,
    i.name,
    b.location_id,
    l.code,
    l.name,
    w.name,
    b.qty,
    b.opening_qty,
    COALESCE(x.net, 0)::numeric AS ledger_net,
    (b.qty - (b.opening_qty + COALESCE(x.net, 0)))::numeric AS drift
    FROM public.inventory_balances b
    JOIN public.inventory_items i ON i.id = b.item_id
    JOIN public.locations l ON l.id = b.location_id
    LEFT JOIN public.warehouses w ON w.id = l.warehouse_id
    LEFT JOIN LATERAL (
      SELECT SUM(ld.qty_change) AS net
        FROM public.inventory_ledger ld
       WHERE ld.item_id = b.item_id
         AND ld.location_id = b.location_id
    ) x ON true
   WHERE (p_location_ids IS NULL
          OR cardinality(p_location_ids) = 0
          OR b.location_id = ANY(p_location_ids))
     AND ABS(b.qty - (b.opening_qty + COALESCE(x.net, 0))) >= 0.0005
   ORDER BY ABS(b.qty - (b.opening_qty + COALESCE(x.net, 0))) DESC, i.name;
END;
$$;

REVOKE ALL ON FUNCTION public.stock_integrity(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stock_integrity(uuid[]) TO authenticated;

-- -------------------------------------------------------------

-- Grant ulang (CREATE OR REPLACE tidak menghapus ACL, ini hanya jaga-jaga).
GRANT EXECUTE ON FUNCTION public.stock_period_report(uuid[], date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.stock_integrity(uuid[]) TO authenticated;
