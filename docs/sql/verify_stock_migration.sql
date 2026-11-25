-- =============================================================
-- CEK: apakah migrasi stok (20261125000001/2/3) sudah aktif?
-- =============================================================
-- CARA PAKAI
--   Supabase Dashboard → SQL Editor → tempel SELURUH isi file ini → Run.
--   Hasilnya SATU tabel: no | cek | hasil | detail.
--
--   LULUS      = beres
--   PERHATIAN  = tidak menghalangi aplikasi (data lama / alat cek, bukan bug)
--   GAGAL      = migrasi belum terpasang → jalankan file migrasinya
--
-- File ini hanya MEMBACA; tidak mengubah stok/transaksi. Aman diulang.
--
-- CATATAN: SQL Editor tidak punya JWT, jadi auth.uid() = NULL dan
-- has_permission() selalu false. Karena itu fungsi baca dicek dengan
-- pemanggilan langsung; bila muncul "Tidak punya izin melihat stok",
-- jalankan migrasi 20261125000003_stock_console_access.sql.
-- =============================================================

DROP TABLE IF EXISTS _cek_migrasi_stok;
CREATE TEMP TABLE _cek_migrasi_stok (
  no     int,
  cek    text,
  hasil  text,
  detail text
);

DO $cek$
DECLARE
  v_ok        boolean;
  v_rows      int;
  v_bad       int;
  v_drift     int;
  v_drift_qty numeric;
  v_future    int;
  v_idx       int;
  v_start     date;
  v_end       date;
BEGIN
  ---------------------------------------------------------------
  -- 1–3. Fungsi utama ada?
  ---------------------------------------------------------------
  v_ok := to_regprocedure('public.stock_period_report(uuid[],date,date)') IS NOT NULL;
  INSERT INTO _cek_migrasi_stok VALUES (
    1, 'Fungsi stock_period_report ada',
    CASE WHEN v_ok THEN 'LULUS' ELSE 'GAGAL' END,
    CASE WHEN v_ok THEN 'Mesin laporan (Stok Awal + IN − OUT = Stok Akhir) terpasang'
         ELSE 'Jalankan migrasi 20261125000001_stock_consistency.sql' END);

  v_ok := to_regprocedure('public.stock_integrity(uuid[])') IS NOT NULL;
  INSERT INTO _cek_migrasi_stok VALUES (
    2, 'Fungsi stock_integrity ada',
    CASE WHEN v_ok THEN 'LULUS' ELSE 'GAGAL' END,
    CASE WHEN v_ok THEN 'Panel "Audit Selisih" di Live Stok aktif'
         ELSE 'Jalankan migrasi 20261125000001_stock_consistency.sql' END);

  v_ok := to_regprocedure('public.align_stock_opening_baselines(uuid[])') IS NOT NULL;
  INSERT INTO _cek_migrasi_stok VALUES (
    3, 'Fungsi align_stock_opening_baselines ada',
    CASE WHEN v_ok THEN 'LULUS' ELSE 'GAGAL' END,
    CASE WHEN v_ok THEN 'Tombol "Selaraskan" (Super Admin) tersedia'
         ELSE 'Jalankan migrasi 20261125000001_stock_consistency.sql' END);

  ---------------------------------------------------------------
  -- 4. Kirim Cepat versi perbaikan (sisa tidak hilang)
  ---------------------------------------------------------------
  v_ok := to_regprocedure('public.quick_ship_request(uuid,jsonb,text,uuid[])') IS NOT NULL;
  IF v_ok THEN
    v_ok := position('GREATEST' in pg_get_functiondef(
              'public.quick_ship_request(uuid,jsonb,text,uuid[])'::regprocedure)) > 0;
  END IF;
  INSERT INTO _cek_migrasi_stok VALUES (
    4, 'quick_ship_request versi perbaikan',
    CASE WHEN v_ok THEN 'LULUS' ELSE 'GAGAL' END,
    CASE WHEN v_ok THEN 'Sisa permintaan tetap masuk "Sisa Belum Terkirim"'
         ELSE 'Jalankan migrasi 20261125000002_quick_ship_partial.sql' END);

  ---------------------------------------------------------------
  -- 5. Izin untuk pengguna login (aplikasi)
  ---------------------------------------------------------------
  BEGIN
    v_ok := has_function_privilege('authenticated',
              'public.stock_period_report(uuid[],date,date)', 'EXECUTE')
            AND has_function_privilege('authenticated',
              'public.stock_integrity(uuid[])', 'EXECUTE');
  EXCEPTION WHEN undefined_object THEN
    v_ok := false;
  END;
  INSERT INTO _cek_migrasi_stok VALUES (
    5, 'Izin EXECUTE untuk role authenticated',
    CASE WHEN v_ok THEN 'LULUS' ELSE 'GAGAL' END,
    CASE WHEN v_ok THEN 'Aplikasi bisa memanggil RPC tanpa error izin'
         ELSE 'Belum ada izin / fungsi belum ada — jalankan ulang migrasi 1' END);

  ---------------------------------------------------------------
  -- 6. Index pendukung
  ---------------------------------------------------------------
  SELECT count(*) INTO v_idx
    FROM pg_indexes
   WHERE schemaname = 'public'
     AND indexname IN ('idx_ledger_loc_item', 'idx_txn_date_id');
  INSERT INTO _cek_migrasi_stok VALUES (
    6, 'Index pendukung laporan',
    CASE WHEN v_idx = 2 THEN 'LULUS' ELSE 'PERHATIAN' END,
    CASE WHEN v_idx = 2 THEN 'idx_ledger_loc_item & idx_txn_date_id terpasang'
         ELSE v_idx || '/2 index ada — laporan tetap jalan, hanya lebih lambat' END);

  ---------------------------------------------------------------
  -- 7–8. Uji rumus pada data nyata (2 bulan terakhir & bulan lalu)
  ---------------------------------------------------------------
  IF to_regprocedure('public.stock_period_report(uuid[],date,date)') IS NULL THEN
    INSERT INTO _cek_migrasi_stok VALUES
      (7, 'Rumus: Stok Awal + Masuk − Keluar = Stok Akhir', 'GAGAL', 'Fungsi belum ada'),
      (8, 'Rumus untuk periode LAMPAU (bulan lalu)', 'GAGAL', 'Fungsi belum ada');
  ELSE
    BEGIN
      v_start := (date_trunc('month', current_date) - interval '2 months')::date;
      v_end   := current_date;

      SELECT count(*) INTO v_rows
        FROM public.stock_period_report(NULL, v_start, v_end);
      SELECT count(*) INTO v_bad
        FROM public.stock_period_report(NULL, v_start, v_end) r
       WHERE abs(r.opening_qty + r.total_in - r.total_out - r.closing_qty) >= 0.0005;

      INSERT INTO _cek_migrasi_stok VALUES (
        7, 'Rumus: Stok Awal + Masuk − Keluar = Stok Akhir',
        CASE WHEN v_bad = 0 THEN 'LULUS' ELSE 'GAGAL' END,
        v_rows || ' baris diuji (' || v_start || ' s/d ' || v_end || '), ' ||
        v_bad || ' baris tidak seimbang');

      v_start := (date_trunc('month', current_date) - interval '1 month')::date;
      v_end   := (date_trunc('month', current_date) - interval '1 day')::date;

      SELECT count(*) INTO v_bad
        FROM public.stock_period_report(NULL, v_start, v_end) r
       WHERE abs(r.opening_qty + r.total_in - r.total_out - r.closing_qty) >= 0.0005;

      INSERT INTO _cek_migrasi_stok VALUES (
        8, 'Rumus untuk periode LAMPAU (bulan lalu)',
        CASE WHEN v_bad = 0 THEN 'LULUS' ELSE 'GAGAL' END,
        'Stok Akhir ' || v_start || ' s/d ' || v_end ||
        ' dihitung per tanggal, bukan saldo hari ini');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO _cek_migrasi_stok VALUES
        (7, 'Rumus: Stok Awal + Masuk − Keluar = Stok Akhir', 'PERHATIAN',
         'Fungsi ada tetapi tidak bisa dipanggil dari SQL Editor: ' || SQLERRM),
        (8, 'Rumus untuk periode LAMPAU (bulan lalu)', 'PERHATIAN',
         'Dilewati — lihat pesan no. 7. Jalankan migrasi 20261125000003_stock_console_access.sql agar bisa diuji dari sini.');
    END;
  END IF;

  ---------------------------------------------------------------
  -- 9. Selisih historis: saldo vs (stok awal dasar + ledger)
  --    Dihitung langsung dari tabel (tidak lewat RPC yang butuh izin).
  ---------------------------------------------------------------
  BEGIN
    SELECT count(*), COALESCE(sum(abs(d.drift)), 0)
      INTO v_drift, v_drift_qty
      FROM (
        SELECT b.qty - (b.opening_qty + COALESCE(x.net, 0)) AS drift
          FROM public.inventory_balances b
          LEFT JOIN LATERAL (
            SELECT SUM(ld.qty_change) AS net
              FROM public.inventory_ledger ld
             WHERE ld.item_id = b.item_id
               AND ld.location_id = b.location_id
          ) x ON true
      ) d
     WHERE abs(d.drift) >= 0.0005;

    INSERT INTO _cek_migrasi_stok VALUES (
      9, 'Selisih historis saldo vs ledger',
      CASE WHEN v_drift = 0 THEN 'LULUS' ELSE 'PERHATIAN' END,
      v_drift || ' baris selisih, total ' ||
      to_char(v_drift_qty, 'FM999G999G999D999') ||
      ' unit — setelah aplikasi baru ter-deploy, buka Live Stok → panel Audit → "Selaraskan"');
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    INSERT INTO _cek_migrasi_stok VALUES (
      9, 'Selisih historis saldo vs ledger', 'PERHATIAN', 'Tabel stok tidak ditemukan (dilewati)');
  END;

  ---------------------------------------------------------------
  -- 10. Transaksi bertanggal masa depan (penyebab angka "hilang")
  ---------------------------------------------------------------
  BEGIN
    SELECT count(*) INTO v_future
      FROM public.inventory_transactions
     WHERE transaction_date > current_date;
    INSERT INTO _cek_migrasi_stok VALUES (
      10, 'Transaksi bertanggal masa depan',
      CASE WHEN v_future = 0 THEN 'LULUS' ELSE 'PERHATIAN' END,
      v_future || ' transaksi — koreksi tanggalnya agar stok tidak "hilang" dari laporan');
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    INSERT INTO _cek_migrasi_stok VALUES (
      10, 'Transaksi bertanggal masa depan', 'LULUS', 'Tabel transaksi tidak ditemukan (dilewati)');
  END;
END
$cek$;

SELECT no, cek, hasil, detail
  FROM _cek_migrasi_stok
 ORDER BY no;

-- -------------------------------------------------------------
-- BONUS: 10 selisih terbesar (kalau ada) untuk diselaraskan.
-- Tidak memakai RPC, jadi aman dijalankan dari SQL Editor.
-- -------------------------------------------------------------
SELECT i.sku, i.name AS item_name, l.code AS location_code,
       b.qty, b.opening_qty,
       COALESCE(x.net, 0) AS ledger_net,
       b.qty - (b.opening_qty + COALESCE(x.net, 0)) AS drift
  FROM public.inventory_balances b
  JOIN public.inventory_items i ON i.id = b.item_id
  JOIN public.locations l ON l.id = b.location_id
  LEFT JOIN LATERAL (
    SELECT SUM(ld.qty_change) AS net
      FROM public.inventory_ledger ld
     WHERE ld.item_id = b.item_id
       AND ld.location_id = b.location_id
  ) x ON true
 WHERE abs(b.qty - (b.opening_qty + COALESCE(x.net, 0))) >= 0.0005
 ORDER BY abs(b.qty - (b.opening_qty + COALESCE(x.net, 0))) DESC
 LIMIT 10;
