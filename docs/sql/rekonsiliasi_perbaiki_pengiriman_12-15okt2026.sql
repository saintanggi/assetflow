-- ===============================================================================
-- REKONSILIASI (PERBAIKI): bersihkan inputan tiket Dokumen Pengiriman
-- 12–15 OKT 2026 yang berantakan, supaya bisa di-upload ulang bersih dari CSV.
-- ===============================================================================
-- PRASYARAT — baca dulu sebelum RUN:
--   [ ] Sudah menjalankan rekonsiliasi_cek_pengiriman_12-15okt2026.sql dan
--       MEMERIKSA bagian "7_AKAN_DIHAPUS_OLEH_PERBAIKI" (daftar persis target).
--   [ ] Fitur hapus-aman Super Admin sudah terpasang (trigger
--       trg_purge_request_inventory_history dari migrasi 20261016000035 /
--       docs/sql/admin_delete_request_and_transaction.sql). Script ini BERHENTI
--       sendiri bila trigger itu belum ada.
--
-- Apa yang dilakukan script ini:
--   Meng-HAPUS semua permintaan (requests) yang nomor tiketnya ada di 4 CSV
--   (52 tiket, daftar di bawah) + blok KURSI TRAINING tanpa tiket versi lama.
--   Berkat trigger purge, transaksi kirim REQ-KIRIM/… yang terkait ikut terhapus
--   dan SALDO STOK DIPULIHKAN (seolah pengiriman itu belum pernah dicatat).
--   Tidak ada data lain yang disentuh.
--
-- WA-IIB dilakukan SETELAH script ini (jangan berhenti di tengah!):
--   1. Buka aplikasi AssetFlow -> menu Permintaan -> Upload Dokumen Pengiriman.
--   2. Upload 4 file dari folder  rekonsiliasi/file-upload-ulang/  (BUKAN file
--      Asli Google Sheet!) dengan urutan 12, 13, 14, 15 OKT.
--      Opsi "Kurangi stok otomatis" HARUS AKTIF supaya stok terpotong ulang.
--      (File upload-ulang = isi sama persis, hanya tanggal kosong sudah diisi
--       dan blok KURSI diberi label tiket — lihat PANDUAN-REKONSILIASI.md.)
--   3. Jalankan lagi rekonsiliasi_cek_pengiriman_12-15okt2026.sql ->
--      bagian 2_SELISIH harus kosong (semua COCOK).
--
-- Keamanan: script ini TIDAK langsung menghapus. Jalankan apa adanya dulu ->
-- muncul pesan jumlah target. Baru ubah  v_yakin := true  lalu RUN lagi.
-- ===============================================================================

-- SQL Editor berjalan sebagai postgres (tanpa JWT). Baris ini membuat
-- is_service_role() = true pada sesi ini agar trigger purge mengizinkan hapus
-- (setara hak akses yang memang sudah kamu punya di SQL Editor).
SELECT set_config('request.jwt.claim.role', 'service_role', false);

-- Daftar tiket dari 4 file CSV (51 tiket HO + 1 label blok KURSI)
DROP TABLE IF EXISTS _rekonsiliasi_tiket;
CREATE TEMP TABLE _rekonsiliasi_tiket (ticket_no text PRIMARY KEY);
INSERT INTO _rekonsiliasi_tiket (ticket_no) VALUES
  ('A2609302102'),
  ('A2610050285'),
  ('A2610080518'),
  ('A2610080540'),
  ('A2610080552'),
  ('A2610090614'),
  ('A2610100732'),
  ('A2610110733'),
  ('A2610110770'),
  ('A2610110773'),
  ('A2610110812'),
  ('A2610120806'),
  ('A2610120808'),
  ('A2610120810'),
  ('A2610120813'),
  ('A2610120814'),
  ('A2610120822'),
  ('A2610120823'),
  ('A2610120825'),
  ('A2610120826'),
  ('A2610120827'),
  ('A2610120830'),
  ('A2610120831'),
  ('A2610120832'),
  ('A2610130866'),
  ('A2610130876'),
  ('A2610130878'),
  ('A2610130880'),
  ('A2610130881'),
  ('A2610130883'),
  ('A2610130887'),
  ('A2610130889'),
  ('A2610130890'),
  ('A2610130899'),
  ('A2610130901'),
  ('A2610130904'),
  ('A2610130908'),
  ('A2610130910'),
  ('A2610140945'),
  ('A2610140946'),
  ('A2610140947'),
  ('A2610140956'),
  ('A2610140957'),
  ('A2610140958'),
  ('A2610140964'),
  ('A2610140965'),
  ('A2610140968'),
  ('A2610140969'),
  ('A2610140970'),
  ('A2610140971'),
  ('A2610140973'),
  ('HLDP-BATCH2-14102026');

DO $$
DECLARE
  v_yakin   boolean := false;  -- <<< GANTI menjadi true setelah memeriksa daftar target di script CEK bagian 7
  v_target  integer;
  v_deleted integer;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'STOP: baris SELECT set_config(...) di atas belum berjalan pada sesi ini. Jalankan SELURUH file ini sekali run.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'trg_purge_request_inventory_history' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'STOP: trigger purge belum terpasang. Jalankan docs/sql/admin_delete_request_and_transaction.sql dulu, baru ulangi script ini. Menghapus tanpa trigger itu akan meninggalkan transaksi stok yatim.';
  END IF;

  SELECT COUNT(*) INTO v_target
    FROM public.requests r
   WHERE (
        upper(btrim(r.ticket_no)) IN (SELECT ticket_no FROM _rekonsiliasi_tiket)
        OR EXISTS (SELECT 1 FROM public.request_items ri
                    WHERE ri.request_id = r.id AND ri.barcode LIKE '%20240004782%')
      );

  RAISE NOTICE 'Target hapus: % permintaan (tiket CSV 12-15 Okt 2026 + blok KURSI lama).', v_target;

  IF v_target = 0 THEN
    RAISE NOTICE 'Tidak ada yang dihapus. Mungkin script ini sudah pernah dijalankan — lanjut ke langkah upload ulang.';
    RETURN;
  END IF;

  IF NOT v_yakin THEN
    RAISE EXCEPTION 'MODE CEK: % permintaan AKAN dihapus (belum ada yang dihapus). Periksa daftarnya di script CEK bagian 7, lalu ganti v_yakin := true dan RUN lagi seluruh file ini.', v_target;
  END IF;

  DELETE FROM public.requests r
   WHERE (
        upper(btrim(r.ticket_no)) IN (SELECT ticket_no FROM _rekonsiliasi_tiket)
        OR EXISTS (SELECT 1 FROM public.request_items ri
                    WHERE ri.request_id = r.id AND ri.barcode LIKE '%20240004782%')
      );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RAISE NOTICE 'SELESAI: % permintaan terhapus. Transaksi kirim terkait ikut dibersihkan dan saldo stok dipulihkan oleh trigger. SEKARANG upload ulang 4 file dari rekonsiliasi/file-upload-ulang/ (urut 12,13,14,15; Kurangi stok otomatis AKTIF), lalu jalankan script CEK lagi.', v_deleted;
END $$;

-- Verifikasi cepat: angka ini harus 0 setelah penghapusan berhasil
SELECT COUNT(*) AS sisa_target_seharusnya_0
  FROM public.requests r
 WHERE (
        upper(btrim(r.ticket_no)) IN (SELECT ticket_no FROM _rekonsiliasi_tiket)
        OR EXISTS (SELECT 1 FROM public.request_items ri
                    WHERE ri.request_id = r.id AND ri.barcode LIKE '%20240004782%')
      );
