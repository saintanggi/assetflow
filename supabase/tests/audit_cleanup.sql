-- AssetFlow: audit keamanan + bersih-bersih sisa data uji (v2).
-- v2: menampung SEMUA id transaksi uji dulu (smoke test + verifikasi API),
-- lalu hapus berurutan sesuai FK: ledger -> items -> transactions.
-- Jalankan di SQL Editor sebagai postgres.

-- 1) AUDIT: daftar SEMUA super_admin (harus hanya 2 akun asli user)
SELECT p.email, r.name AS role, p.created_at
FROM public.profiles p
JOIN public.roles r ON r.id = p.role_id
WHERE r.name = 'super_admin'
ORDER BY p.created_at;

-- 2) Hapus user uji smoke test bila masih ada
DELETE FROM public.user_permissions
WHERE user_id IN (SELECT id FROM public.profiles WHERE email LIKE 'rls-smoke-%@example.com');
DELETE FROM public.profiles WHERE email LIKE 'rls-smoke-%@example.com';
DELETE FROM auth.users WHERE email LIKE 'rls-smoke-%@example.com';

-- 3) Kumpulkan semua transaksi uji (smoke test + verifikasi API)
CREATE TEMP TABLE _txn_uji AS
SELECT id FROM public.inventory_transactions
WHERE notes IN ('smoke-test', 'verifikasi API T8c')
   OR reference LIKE 'PO-TEST%'
   OR reference = 'PO-VERIF'
   OR doc_number LIKE 'IN-2026-%'
   OR doc_number LIKE 'REV-2026-%';

-- 4) Hapus berurutan sesuai FK
DELETE FROM public.inventory_ledger WHERE transaction_id IN (SELECT id FROM _txn_uji);
DELETE FROM public.inventory_transaction_items WHERE transaction_id IN (SELECT id FROM _txn_uji);
DELETE FROM public.inventory_transactions WHERE id IN (SELECT id FROM _txn_uji) AND reversal_of IS NOT NULL;
DELETE FROM public.inventory_transactions WHERE id IN (SELECT id FROM _txn_uji);

-- 5) Saldo, item, dan artefak uji lain
DELETE FROM public.inventory_balances
WHERE item_id IN (SELECT id FROM public.inventory_items WHERE sku = 'TEST-SKU-001');
DELETE FROM public.stock_count_items
WHERE stock_count_id IN (SELECT id FROM public.stock_counts WHERE notes = 'smoke-test');
DELETE FROM public.stock_counts WHERE notes = 'smoke-test';
DELETE FROM public.assets WHERE asset_code = 'TEST-AST-001';
DELETE FROM public.inventory_items WHERE sku = 'TEST-SKU-001';

-- 6) Verifikasi akhir
SELECT count(*) AS sisa_user_uji FROM auth.users WHERE email LIKE 'rls-smoke-%@example.com';
SELECT count(*) AS sisa_txn_uji FROM public.inventory_transactions;
SELECT count(*) AS sisa_item_uji FROM public.inventory_items WHERE sku = 'TEST-SKU-001';
SELECT count(*) AS sisa_saldo FROM public.inventory_balances;
