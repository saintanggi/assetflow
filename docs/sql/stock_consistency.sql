-- =============================================================
-- 20261125000001 — Konsistensi Laporan Stok
-- =============================================================
-- MASALAH YANG DIPERBAIKI
-- Laporan stok (Live Stok, Asset Baru/Return/Unready, Kartu Stok) memakai
-- campuran tiga sumber angka:
--   1. saldo live (inventory_balances.qty)        -> "Stok Akhir"
--   2. ledger difilter created_at (bukan
--      transaction_date/tanggal dokumen)          -> "IN"/"OUT"
--   3. opening_qty yang diedit manual             -> "Stok Awal"
-- Akibatnya Stok Awal + IN - OUT hampir selalu != Stok Akhir: transaksi
-- bertanggal lampau dihitung di hari posting, dan periode lampau memakai
-- saldo hari ini. Selain itu tidak ada alat untuk mendeteksi saldo yang
-- tidak lagi sama dengan Stok Awal dasar + seluruh mutasi ledger (mis. sisa
-- data lama sebelum mesin transaksi RPC dipakai).
--
-- SOLUSI
--   * stock_period_report()  : satu-satunya rumus laporan stok. Semua angka
--     diturunkan dari saldo live + ledger berdasarkan TANGGAL TRANSAKSI,
--     sehingga opening + in - out = closing secara aritmetika:
--        closing(D)      = saldo live - mutasi bertanggal > D
--        opening(periode)= closing - mutasi dalam periode
--   * stock_integrity()      : daftar (item, lokasi) yang saldo live-nya tidak
--     sama dengan Stok Awal dasar + seluruh mutasi ledger (selisih historis).
--   * align_stock_opening_baselines() : Super Admin menyelaraskan Stok Awal
--     dasar ke angka yang konsisten (TIDAK mengubah stok fisik) + jejak audit.
-- =============================================================

-- Mempercepat rekap ledger per (lokasi, item) dan filter tanggal dokumen.
CREATE INDEX IF NOT EXISTS idx_ledger_loc_item
  ON public.inventory_ledger(location_id, item_id);
CREATE INDEX IF NOT EXISTS idx_txn_date_id
  ON public.inventory_transactions(transaction_date, id);

-- -------------------------------------------------------------
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
  IF NOT public.has_permission('inventory.view') THEN
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
  IF NOT public.has_permission('inventory.view') THEN
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
-- 3. Selaraskan Stok Awal dasar (Super Admin, stok fisik TIDAK berubah)
-- -------------------------------------------------------------
-- Menyetel opening_qty := qty - mutasi ledger. Saldo live dan seluruh
-- transaksi tidak diubah; hanya angka dasar "Stok Awal" yang diluruskan
-- dengan riwayat, sehingga laporan periode apa pun cocok dan
-- Stok Awal + IN - OUT = Stok Akhir untuk rentang tanggal apa pun.
CREATE OR REPLACE FUNCTION public.align_stock_opening_baselines(
  p_location_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  r         record;
  v_count   integer := 0;
  v_drift   numeric := 0;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Hanya Super Admin yang boleh menyelaraskan Stok Awal dasar';
  END IF;

  FOR r IN
    SELECT
      b.item_id,
      b.location_id,
      b.qty,
      b.opening_qty,
      COALESCE(x.net, 0) AS net,
      (b.qty - COALESCE(x.net, 0)) AS new_opening,
      i.name AS item_name,
      l.code AS loc_code
      FROM public.inventory_balances b
      JOIN public.inventory_items i ON i.id = b.item_id
      JOIN public.locations l ON l.id = b.location_id
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
     ORDER BY b.item_id, b.location_id
     FOR UPDATE OF b
  LOOP
    UPDATE public.inventory_balances
       SET opening_qty = r.new_opening,
           updated_at  = now()
     WHERE item_id = r.item_id
       AND location_id = r.location_id;

    INSERT INTO public.audit_logs
      (actor_id, action, entity_type, entity_id, old_data, new_data)
    VALUES (
      auth.uid(), 'UPDATE', 'inventory_balances', r.item_id::text,
      jsonb_build_object(
        'item', r.item_name,
        'location_code', r.loc_code,
        'opening_qty', r.opening_qty,
        'qty', r.qty,
        'ledger_net', r.net
      ),
      jsonb_build_object(
        'item', r.item_name,
        'location_code', r.loc_code,
        'opening_qty', r.new_opening,
        'qty', r.qty,
        'ledger_net', r.net,
        'reason', 'selaras stok awal dasar (stok fisik tidak berubah)'
      )
    );

    v_count := v_count + 1;
    v_drift := v_drift + ABS(r.qty - (r.opening_qty + r.net));
  END LOOP;

  RETURN jsonb_build_object(
    'rows_aligned', v_count,
    'total_drift', v_drift
  );
END;
$$;

REVOKE ALL ON FUNCTION public.align_stock_opening_baselines(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.align_stock_opening_baselines(uuid[]) TO authenticated;
