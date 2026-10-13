-- Update harga barang (purchase_price) dari DAFTAR_HARGA.xlsx
-- 21 item cocok persis dengan master.

UPDATE public.inventory_items SET purchase_price = 3350000 WHERE upper(name) = 'AC 1 PK';
UPDATE public.inventory_items SET purchase_price = 5500000 WHERE upper(name) = 'AC 2 PK';
UPDATE public.inventory_items SET purchase_price = 1596825 WHERE upper(name) = 'CAMERA IPEVO';
UPDATE public.inventory_items SET purchase_price = 73000 WHERE upper(name) = 'DONGLE WIFI';
UPDATE public.inventory_items SET purchase_price = 1175000 WHERE upper(name) = 'HANDPHONE ANDROID';
UPDATE public.inventory_items SET purchase_price = 4200000 WHERE upper(name) = 'KOMPUTER RAKITAN';
UPDATE public.inventory_items SET purchase_price = 5100000 WHERE upper(name) = 'KOMPUTER SERVER RAKITAN';
UPDATE public.inventory_items SET purchase_price = 170000 WHERE upper(name) = 'KURSI BASO';
UPDATE public.inventory_items SET purchase_price = 585000 WHERE upper(name) = 'KURSI STAFF SAVELLO';
UPDATE public.inventory_items SET purchase_price = 245545 WHERE upper(name) = 'KURSI BASO KAYU';
UPDATE public.inventory_items SET purchase_price = 200000 WHERE upper(name) = 'LACI';
UPDATE public.inventory_items SET purchase_price = 167000 WHERE upper(name) = 'LEMARI ARSIP';
UPDATE public.inventory_items SET purchase_price = 1944650 WHERE upper(name) = 'LEMARI BESI';
UPDATE public.inventory_items SET purchase_price = 84000 WHERE upper(name) = 'MESIN CMD';
UPDATE public.inventory_items SET purchase_price = 1075000 WHERE upper(name) = 'MESIN JAHIT';
UPDATE public.inventory_items SET purchase_price = 760000 WHERE upper(name) = 'MODEM WIFI TPLINK MR100';
UPDATE public.inventory_items SET purchase_price = 1130000 WHERE upper(name) = 'MONITOR';
UPDATE public.inventory_items SET purchase_price = 26000 WHERE upper(name) = 'METERAN TEKIRO 5M';
UPDATE public.inventory_items SET purchase_price = 57000 WHERE upper(name) = 'SPEAKER PC';
UPDATE public.inventory_items SET purchase_price = 980000 WHERE upper(name) = 'UPS';
UPDATE public.inventory_items SET purchase_price = 58000 WHERE upper(name) = 'USB 4 PORT';

-- Verifikasi:
SELECT count(*) AS updated FROM public.inventory_items WHERE purchase_price > 0;