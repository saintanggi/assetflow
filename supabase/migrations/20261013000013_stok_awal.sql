-- Kolom stok awal per item per lokasi.
ALTER TABLE public.inventory_balances
  ADD COLUMN IF NOT EXISTS opening_qty numeric(15,3) NOT NULL DEFAULT 0;

-- Pindahkan qty "Atur Stok" (via menu Persediaan) menjadi stok awal:
-- 1) Set opening_qty = saldo saat ini untuk semua balance yang ada.
UPDATE public.inventory_balances SET opening_qty = qty WHERE qty <> 0;

-- 2) Hapus transaksi "Atur Stok" dari ledger, items, dan header
--    (teridentifikasi dari notes), agar tidak dobel hitung sebagai IN.
DELETE FROM public.inventory_ledger
WHERE transaction_id IN (
  SELECT id FROM public.inventory_transactions
  WHERE notes LIKE '%via menu Persediaan%'
);
DELETE FROM public.inventory_transaction_items
WHERE transaction_id IN (
  SELECT id FROM public.inventory_transactions
  WHERE notes LIKE '%via menu Persediaan%'
);
DELETE FROM public.inventory_transactions
WHERE notes LIKE '%via menu Persediaan%';
