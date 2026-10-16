-- cek-saldo-negatif.sql — Diagnostik read-only: daftar semua saldo NEGATIF (item x lokasi).
--
-- LATAR: Bug "Stok tidak mencukupi" saat Barang Masuk terjadi karena saldo lokasi
-- sedang negatif (contoh: -8 di Stok Barang Retur), sisa dari sinkronisasi
-- Google Sheet yang memang diizinkan membuat stok minus. Guard database sudah
-- diperbaiki (migrasi 20261016000031) sehingga Barang Masuk tidak lagi ditolak,
-- TAPI saldo negatifnya sendiri belum hilang.
--
-- KENAPA PENTING: selama saldo masih negatif,
--   1. Barang KELUAR dari lokasi itu tetap DITOLAK guard (contoh: -8 keluar 1
--      => -9 < 0 => "Stok tidak mencukupi") — barang jadi terkunci di lokasi.
--   2. Dashboard "Command Center" & peringatan stok minimum menampilkan angka
--      negatif yang membingungkan.
--
-- CARA PAKAI: Supabase Dashboard → SQL Editor → New query → copas seluruh isi
-- file ini → Run. Query ini HANYA membaca (SELECT), tidak mengubah data.
-- Untuk tiap baris yang muncul: cek fisik barangnya, lalu betulkan lewat menu
-- Stock Opname di aplikasi (bukan lewat query ini).

SELECT
  i.sku          AS sku,
  i.name         AS barang,
  w.name         AS gudang,
  l.code         AS kode_lokasi,
  l.name         AS lokasi,
  b.qty          AS saldo_saat_ini,
  COALESCE(u.code, '-') AS satuan
FROM public.inventory_balances AS b
JOIN public.inventory_items  AS i ON i.id = b.item_id
JOIN public.locations        AS l ON l.id = b.location_id
JOIN public.warehouses       AS w ON w.id = l.warehouse_id
LEFT JOIN public.units       AS u ON u.id = i.unit_id
WHERE b.qty < 0
ORDER BY b.qty ASC, i.name ASC;
