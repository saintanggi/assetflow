-- =============================================================
-- RESET TOTAL DATA INVENTORY — BAGIAN 1: BACKUP
-- Tanggal: 2026-11-02 | Tujuan: fresh start untuk Stock Opname gudang
-- Menyalin seluruh data ke tabel backup_20261102_* (tetap di database,
-- tidak mengganggu aplikasi). Jalankan BAGIAN 2 hanya setelah verifikasi
-- jumlah baris backup == jumlah baris sumber.
-- =============================================================

CREATE TABLE IF NOT EXISTS backup_20261102_inventory_ledger AS
  SELECT * FROM public.inventory_ledger;

CREATE TABLE IF NOT EXISTS backup_20261102_inventory_transaction_items AS
  SELECT * FROM public.inventory_transaction_items;

CREATE TABLE IF NOT EXISTS backup_20261102_inventory_transactions AS
  SELECT * FROM public.inventory_transactions;

CREATE TABLE IF NOT EXISTS backup_20261102_inventory_balances AS
  SELECT * FROM public.inventory_balances;

CREATE TABLE IF NOT EXISTS backup_20261102_request_items AS
  SELECT * FROM public.request_items;

CREATE TABLE IF NOT EXISTS backup_20261102_requests AS
  SELECT * FROM public.requests;

-- ---------- Verifikasi: bandingkan jumlah baris ----------
SELECT 'ledger' AS tabel,
       (SELECT COUNT(*) FROM public.inventory_ledger) AS sumber,
       (SELECT COUNT(*) FROM backup_20261102_inventory_ledger) AS backup
UNION ALL
SELECT 'txn_items',
       (SELECT COUNT(*) FROM public.inventory_transaction_items),
       (SELECT COUNT(*) FROM backup_20261102_inventory_transaction_items)
UNION ALL
SELECT 'transactions',
       (SELECT COUNT(*) FROM public.inventory_transactions),
       (SELECT COUNT(*) FROM backup_20261102_inventory_transactions)
UNION ALL
SELECT 'balances',
       (SELECT COUNT(*) FROM public.inventory_balances),
       (SELECT COUNT(*) FROM backup_20261102_inventory_balances)
UNION ALL
SELECT 'request_items',
       (SELECT COUNT(*) FROM public.request_items),
       (SELECT COUNT(*) FROM backup_20261102_request_items)
UNION ALL
SELECT 'requests',
       (SELECT COUNT(*) FROM public.requests),
       (SELECT COUNT(*) FROM backup_20261102_requests);
