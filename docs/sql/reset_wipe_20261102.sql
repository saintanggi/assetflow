-- =============================================================
-- RESET TOTAL DATA INVENTORY — BAGIAN 2: WIPE
-- Tanggal: 2026-11-02 | Tujuan: fresh start untuk Stock Opname gudang
-- PERINGATAN: hapus permanen. Hanya jalankan SETELAH Bagian 1 (backup)
-- terverifikasi (jumlah baris backup == sumber untuk semua tabel).
--
-- Yang dihapus:
--   - inventory_ledger, inventory_transaction_items, inventory_transactions
--   - inventory_balances (saldo stok → kosong)
--   - request_items, requests (riwayat permintaan)
-- Yang TIDAK dihapus:
--   - master barang, lokasi, gudang, kategori, satuan, supplier, user, dsb.
--   - audit_logs, asset_movements (modul aset tetap)
-- Nomor dokumen (doc_counters) tahun berjalan di-reset ke 0 agar penomoran
-- mulai lagi dari ...-000001.
-- =============================================================

-- Urutan aman terhadap foreign key.
DELETE FROM public.inventory_ledger;
DELETE FROM public.inventory_transaction_items;
DELETE FROM public.inventory_transactions;
DELETE FROM public.inventory_balances;
DELETE FROM public.request_items;
DELETE FROM public.requests;

-- Reset nomor dokumen tahun berjalan.
UPDATE public.doc_counters
   SET last_number = 0
 WHERE year = EXTRACT(YEAR FROM now())::int;

-- ---------- Verifikasi akhir: semua harus 0 ----------
SELECT 'inventory_ledger' AS tabel, COUNT(*) AS sisa FROM public.inventory_ledger
UNION ALL SELECT 'inventory_transaction_items', COUNT(*) FROM public.inventory_transaction_items
UNION ALL SELECT 'inventory_transactions', COUNT(*) FROM public.inventory_transactions
UNION ALL SELECT 'inventory_balances', COUNT(*) FROM public.inventory_balances
UNION ALL SELECT 'request_items', COUNT(*) FROM public.request_items
UNION ALL SELECT 'requests', COUNT(*) FROM public.requests;
