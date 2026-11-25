-- =============================================================
-- CEK: apakah migrasi stok (20261125000001 & 20261125000002) sudah aktif?
-- =============================================================
-- CARA PAKAI
--   Supabase Dashboard → SQL Editor → tempel SELURUH isi file ini → Run.
--   Hasilnya SATU tabel dengan kolom: no | cek | hasil | detail.
--   Semua baris harus "LULUS". "PERHATIAN" tidak menghalangi aplikasi,
--   hanya menandakan ada data lama yang perlu dibersihkan.
--
-- File ini hanya MEMBACA. Tidak mengubah stok/transaksi apa pun.
-- Aman dijalankan berkali-kali.
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
BEGIN
  -- 1. Fungsi laporan periode ada?
  v_ok := to_regprocedure('public.stock_period_report(uuid[],date,date)') IS NOT NULL;
  INSERT INTO _cek_migrasi_stok VALUES (
    1, 'Fungsi stock_period_report ada',
    CASE WHEN v_ok THEN 'LULUS' ELSE 'GAGAL' END,
    CASE WHEN v_ok THEN 'RPC siap dipakai Live Stok & Stok Kondisi'
         ELSE 'Belum ada. Jalankan migrasi 20261125000001_stock_consistency.sql' END);

  -- 2. Fungsi audit selisih ada?
  v_ok := to_regprocedure('public.stock_integrity(uuid[])') IS NOT NULL;
  INSERT INTO _cek_migrasi_stok VALUES (
    2, 'Fungsi stock_integrity ada',
    CASE WHEN v_ok THEN 'LULUS' ELSE 'GAGAL' END,
    CASE WHEN v_ok THEN 'Panel "Audit Selisih" aktif'
         ELSE 'Belum ada. Jalankan migrasi 20261125000001_stock_consistency.sql' END);

  -- 3. Fungsi penyelarasan ada?
  v_ok := to_regprocedure('public.align_stock_opening_baselines(uuid[])') IS NOT NULL;
  INSERT INTO _cek_migrasi_stok VALUES (
    3, 'Fungsi align_stock_opening_baselines ada',
    CASE WHEN v_ok THEN 'LULUS' ELSE 'GAGAL' END,
    CASE WHEN v_ok THEN 'Tombol "Selaraskan" (Super Admin) tersedia'
         ELSE 'Belum ada. Jalankan migrasi 20261125000001_stock_consistency.sql' END);

  -- 4. Kirim Cepat sudah versi perbaikan (sisa tidak hilang)?
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

  -- 5. Izin EXECUTE untuk pengguna login?
  BEGIN
    v_ok := has_function_privilege('authenticated',
              'public.stock_period_report(uuid[],date,date)', 'EXECUTE')
            AND has_function_privilege('authenticated',
              'public.stock_integrity(uuid[])', 'EXECUTE');
  EXCEPTION WHEN undefined_object THEN
    v_ok := false; -- role authenticated belum ada (DB non-Supabase)
  END;
  INSERT INTO _cek_migrasi_stok VALUES (
    5, 'Izin EXECUTE untuk role authenticated',
    CASE WHEN v_ok THEN 'LULUS' ELSE 'GAGAL' END,
    CASE WHEN v_ok THEN 'Aplikasi bisa memanggil RPC tanpa error izin'
         ELSE 'Tidak ada izin / fungsi belum ada — jalankan ulang migrasi 1' END);

  -- 6. Index pendukung ada?
  SELECT count(*) INTO v_idx
    FROM pg_indexes
   WHERE schemaname = 'public'
     AND indexname IN ('idx_ledger_loc_item', 'idx_txn_date_id');
  INSERT INTO _cek_migrasi_stok VALUES (
    6, 'Index pendukung laporan',
    CASE WHEN v_idx = 2 THEN 'LULUS' ELSE 'PERHATIAN' END,
    CASE WHEN v_idx = 2 THEN 'idx_ledger_loc_item & idx_txn_date_id terpasang'
         ELSE v_idx || '/2 index ada — laporan tetap jalan, hanya lebih lambat' END);

  -- 7 & 8. Uji rumus pada data nyata: 2 bulan terakhir + bulan lalu.
  IF to_regprocedure('public.stock_period_report(uuid[],date,date)') IS NOT NULL THEN
    BEGIN
      SELECT count(*) INTO v_rows
        FROM public.stock_period_report(
               NULL, (date_trunc('month', current_date) - interval '2 months')::date, current_date);
      SELECT count(*) INTO v_bad
        FROM public.stock_period_report(
               NULL, (date_trunc('month', current_date) - interval '2 months')::date, current_date) r
       WHERE abs(r.opening_qty + r.total_in - r.total_out - r.closing_qty) >= 0.0005;

      INSERT INTO _cek_migrasi_stok VALUES (
        7, 'Stok Awal + Masuk − Keluar = Stok Akhir (2 bulan)',
        CASE WHEN v_bad = 0 THEN 'LULUS' ELSE 'GAGAL' END,
        v_rows || ' baris diuji, ' || v_bad || ' baris tidak seimbang');

      SELECT count(*) INTO v_bad
        FROM public.stock_period_report(
               NULL,
               (date_trunc('month', current_date) - interval '1 month')::date,
               (date_trunc('month', current_date) - interval '1 day')::date) r
       WHERE abs(r.opening_qty + r.total_in - r.total_out - r.closing_qty) >= 0.0005;

      INSERT INTO _cek_migrasi_stok VALUES (
        8, 'Rumus untuk periode LAMPAU (bulan lalu)',
        CASE WHEN v_bad = 0 THEN 'LULUS' ELSE 'GAGAL' END,
        'Stok Akhir periode lama dihitung per tanggal, bukan saldo hari ini');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO _cek_migrasi_stok VALUES (
        7, 'Uji rumus pada data nyata', 'GAGAL', SQLERRM);
    END;
  ELSE
    INSERT INTO _cek_migrasi_stok VALUES
      (7, 'Uji rumus pada data nyata', 'GAGAL', 'Fungsi belum ada'),
      (8, 'Rumus untuk periode LAMPAU', 'GAGAL', 'Fungsi belum ada');
  END IF;

  -- 9. Selisih historis (saldo vs stok awal dasar + ledger).
  IF to_regprocedure('public.stock_integrity(uuid[])') IS NOT NULL THEN
    BEGIN
      SELECT count(*), COALESCE(sum(abs(drift)), 0)
        INTO v_drift, v_drift_qty
        FROM public.stock_integrity(NULL);
      INSERT INTO _cek_migrasi_stok VALUES (
        9, 'Selisih historis saldo vs ledger',
        CASE WHEN v_drift = 0 THEN 'LULUS' ELSE 'PERHATIAN' END,
        v_drift || ' baris selisih, total ' ||
        to_char(v_drift_qty, 'FM999G999G999D999') ||
        ' unit — buka Live Stok → panel Audit, lalu "Selaraskan"');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO _cek_migrasi_stok VALUES (
        9, 'Selisih historis saldo vs ledger', 'PERHATIAN', SQLERRM);
    END;
  END IF;

  -- 10. Transaksi bertanggal masa depan (sumber angka "hilang").
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
-- BONUS: 10 selisih terbesar (kalau ada) — untuk diselaraskan.
-- -------------------------------------------------------------
SELECT sku, item_name, location_code, qty, opening_qty, ledger_net, drift
  FROM public.stock_integrity(NULL)
 ORDER BY abs(drift) DESC
 LIMIT 10;
