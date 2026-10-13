-- RESET MASTER BARANG: hapus semua, isi 90 item unik dari MASTER_DATA_ASSET.xlsx
-- Stok awal, buffer (min_stock), foto dikosongkan.

BEGIN;

-- 1) Hapus data turunan (urutan aman FK).
DELETE FROM public.hist_staging;
DELETE FROM public.request_items;
DELETE FROM public.requests;
DELETE FROM public.inventory_ledger;
DELETE FROM public.inventory_transaction_items;
DELETE FROM public.inventory_transactions;
DELETE FROM public.inventory_balances;
DELETE FROM public.stock_count_items;
DELETE FROM public.stock_counts;
DELETE FROM public.inventory_items;

-- 2) Reset sequence penomoran permintaan.
ALTER SEQUENCE IF EXISTS public.request_number_seq RESTART WITH 1;

-- 3) Insert 90 item unik (satuan PCS, tanpa stok/buffer/foto).
WITH pcs AS (SELECT id FROM public.units WHERE upper(code) = 'PCS' LIMIT 1)
INSERT INTO public.inventory_items (sku, name, unit_id, min_stock, is_active)
SELECT v.sku, v.name, pcs.id, 0, true
FROM pcs, (VALUES
  ('BRG-0001', 'AC 1 PK'),
  ('BRG-0002', 'AC 2 PK'),
  ('BRG-0003', 'ADAPTOR MULTI'),
  ('BRG-0004', 'AIR PURIFIER'),
  ('BRG-0005', 'BAG HOLDER'),
  ('BRG-0006', 'BAG RACK'),
  ('BRG-0007', 'BRACKET 2 PC'),
  ('BRG-0008', 'BRANKAS'),
  ('BRG-0009', 'CAMERA CCTV INDOOR'),
  ('BRG-0010', 'CAMERA CCTV OUTDOOR'),
  ('BRG-0011', 'CAMERA IPEVO'),
  ('BRG-0012', 'CPU RAKITAN'),
  ('BRG-0013', 'CPU SERVER'),
  ('BRG-0014', 'DISPENSER'),
  ('BRG-0015', 'DONGLE WIFI'),
  ('BRG-0016', 'DVR 16 CH'),
  ('BRG-0017', 'DVR 32 CH'),
  ('BRG-0018', 'DVR 8 CH'),
  ('BRG-0019', 'EXHAUST FAN'),
  ('BRG-0020', 'GENSET'),
  ('BRG-0021', 'HANDPALLET'),
  ('BRG-0022', 'HANDPHONE ANDROID'),
  ('BRG-0023', 'HOOK S'),
  ('BRG-0024', 'IP CAM INDOOR'),
  ('BRG-0025', 'IP CAM OUTDOOR'),
  ('BRG-0026', 'KERANJANG BESI SORTIR'),
  ('BRG-0027', 'KEYBOARD'),
  ('BRG-0028', 'KIPAS ANGIN'),
  ('BRG-0029', 'KIPAS ANGIN CEILING'),
  ('BRG-0030', 'KIPAS ANGIN CKE'),
  ('BRG-0031', 'KOMPUTER RAKITAN'),
  ('BRG-0032', 'KOMPUTER SERVER RAKITAN'),
  ('BRG-0033', 'KURSI BASO'),
  ('BRG-0034', 'KURSI BASO KAYU'),
  ('BRG-0035', 'KURSI MANAGER'),
  ('BRG-0036', 'KURSI STAFF MERAH'),
  ('BRG-0037', 'KURSI STAFF SAVELLO'),
  ('BRG-0038', 'LACI'),
  ('BRG-0039', 'LACI FILLING CABINET'),
  ('BRG-0040', 'LAPTOP CORE I3'),
  ('BRG-0041', 'LAPTOP CORE I5'),
  ('BRG-0042', 'LAPTOP CORE I7'),
  ('BRG-0043', 'LEMARI ARSIP'),
  ('BRG-0044', 'LEMARI BESI'),
  ('BRG-0045', 'MEJA'),
  ('BRG-0046', 'MEJA FLEKSIBEL'),
  ('BRG-0047', 'MEJA MEETING 240 CM'),
  ('BRG-0048', 'MESIN CMD'),
  ('BRG-0049', 'MESIN JAHIT'),
  ('BRG-0050', 'METERAN TEKIRO 5M'),
  ('BRG-0051', 'MIKROTIK'),
  ('BRG-0052', 'MODEM WIFI TPLINK MR100'),
  ('BRG-0053', 'MONITOR'),
  ('BRG-0054', 'MOUSE'),
  ('BRG-0055', 'PALLET MESH'),
  ('BRG-0056', 'PALLET PLASTIK'),
  ('BRG-0057', 'PC ALL IN ONE'),
  ('BRG-0058', 'PRINTER CANON LASERJET'),
  ('BRG-0059', 'PRINTER HPRT'),
  ('BRG-0060', 'PRINTER TSC'),
  ('BRG-0061', 'PRINTER TSC TE 310'),
  ('BRG-0062', 'PRINTER TSC TE4502'),
  ('BRG-0063', 'PSU'),
  ('BRG-0064', 'RAK KERANJANG'),
  ('BRG-0065', 'RAK SERVER 8U'),
  ('BRG-0066', 'RAM BESI'),
  ('BRG-0067', 'ROUTER WIFI'),
  ('BRG-0068', 'SCANNER KABEL 2D'),
  ('BRG-0069', 'SCANNER PDA'),
  ('BRG-0070', 'SCANNER WIRELESS'),
  ('BRG-0071', 'SPEAKER PC'),
  ('BRG-0072', 'STANDING KARUNG'),
  ('BRG-0073', 'SWITCH HUB 24 PORT'),
  ('BRG-0074', 'SWITCH HUB PORT 16 CAT 6'),
  ('BRG-0075', 'SWITCH HUB PORT 24'),
  ('BRG-0076', 'SWITCH HUB PORT 48'),
  ('BRG-0077', 'SWITCH HUB PORT 8 CAT 6'),
  ('BRG-0078', 'TANGGA'),
  ('BRG-0079', 'TIMBANGAN TOLEDO'),
  ('BRG-0080', 'TIMBANGAN TOLEDO + KABEL'),
  ('BRG-0081', 'TROLLY BARANG'),
  ('BRG-0082', 'TROLLY KERANJANG BESAR'),
  ('BRG-0083', 'TROLLY KERANJANG KECIL'),
  ('BRG-0084', 'UPS'),
  ('BRG-0085', 'USB 4 PORT'),
  ('BRG-0086', 'USB 8 PORT'),
  ('BRG-0087', 'WHITBOARD BESAR'),
  ('BRG-0088', 'WHITEBOARD 120x90CM'),
  ('BRG-0089', 'WHITEBOARD 180X120CM'),
  ('BRG-0090', 'WHITEBOARD 180X90CM')
) AS v(sku, name);

COMMIT;

-- Verifikasi:
SELECT count(*) AS total_item FROM public.inventory_items;