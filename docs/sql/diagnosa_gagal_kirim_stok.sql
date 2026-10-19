-- diagnosa_gagal_kirim_stok.sql — Diagnostik READ-ONLY untuk kasus
-- "Stok ... tidak cukup (tersedia ?, dibutuhkan ...)" saat Kirim Permintaan.
--
-- LATAR
--   Menu Persediaan menampilkan stok TOTAL = jumlah saldo SEMUA lokasi.
--   RPC ship_request_items TIDAK memotong dari total itu: ia memotong dari SATU
--   lokasi saja, ditentukan oleh status_aset baris permintaan
--   (migrasi 20261016000032):
--       ASSET BARU   -> STOK-BARU
--       ASSET RETUR  -> STOK-RETUR
--       UNREADY      -> STOK-UNREADY
--   Jadi stok 22 bisa terlihat "ada" di Persediaan tetapi lokasi yang dipotong
--   saldonya 0 atau NEGATIF -> "Stok tidak mencukupi".
--
--   Catatan: pesan "tersedia ?" muncul karena regex di RequestDetailPage hanya
--   menangkap angka positif; bila saldo lokasi NEGATIF (mis. -8.000) angka itu
--   tidak terbaca dan ditampilkan sebagai "?".
--
-- CARA PAKAI
--   Supabase Dashboard -> SQL Editor -> New query -> ubah kata kunci di baris
--   `cari` bila perlu -> Run. Query ini HANYA membaca (SELECT), tidak mengubah
--   data apa pun.

WITH param AS (
  SELECT 'MONITOR'::text AS cari
),
item AS (
  SELECT i.id, i.sku, i.name
  FROM public.inventory_items i, param p
  WHERE i.name ILIKE '%' || p.cari || '%'
     OR i.sku  ILIKE '%' || p.cari || '%'
),
-- 1. Saldo per (barang x lokasi) + total semua lokasi.
saldo AS (
  SELECT
    it.sku,
    it.name                                        AS barang,
    w.name                                         AS gudang,
    l.code                                         AS kode_lokasi,
    l.name                                         AS lokasi,
    b.qty                                          AS saldo_lokasi,
    SUM(b.qty) OVER (PARTITION BY it.id)           AS total_semua_lokasi,
    CASE WHEN b.qty < 0 THEN 'NEGATIF -> INI PENYEBABNYA' ELSE '' END AS catatan
  FROM public.inventory_balances b
  JOIN item it               ON it.id = b.item_id
  JOIN public.locations l    ON l.id = b.location_id
  JOIN public.warehouses w   ON w.id = l.warehouse_id
)
SELECT
  sku,
  barang,
  gudang,
  kode_lokasi,
  lokasi,
  saldo_lokasi,
  total_semua_lokasi,
  catatan
FROM saldo
ORDER BY saldo_lokasi ASC;

-- 2. Baris permintaan MONITOR yang belum terkirim: ke lokasi mana ia akan
--    dipotong, dan berapa saldo lokasi itu sekarang.
--
-- SELECT
--   r.request_number,
--   COALESCE(r.ticket_no, '-')                       AS no_tiket,
--   ri.status_aset,
--   CASE
--     WHEN upper(COALESCE(ri.status_aset, '')) LIKE '%UNREADY%' THEN 'STOK-UNREADY'
--     WHEN upper(COALESCE(ri.status_aset, '')) LIKE '%RETUR%'   THEN 'STOK-RETUR'
--     ELSE 'STOK-BARU'
--   END                                              AS lokasi_potong,
--   COALESCE(b.qty, 0)                               AS saldo_lokasi_potong,
--   ri.qty_approved,
--   ri.qty_shipped,
--   (COALESCE(ri.qty_approved, 0) - COALESCE(ri.qty_shipped, 0)) AS sisa_kirim,
--   ri.item_status
-- FROM public.request_items ri
-- JOIN public.requests r ON r.id = ri.request_id
-- JOIN item it           ON it.id = ri.item_id
-- LEFT JOIN public.locations l
--   ON l.code = CASE
--        WHEN upper(COALESCE(ri.status_aset, '')) LIKE '%UNREADY%' THEN 'STOK-UNREADY'
--        WHEN upper(COALESCE(ri.status_aset, '')) LIKE '%RETUR%'   THEN 'STOK-RETUR'
--        ELSE 'STOK-BARU'
--      END
-- LEFT JOIN public.inventory_balances b
--   ON b.item_id = ri.item_id AND b.location_id = l.id
-- WHERE ri.item_status NOT IN ('terkirim', 'ditolak')
-- ORDER BY r.request_date DESC, r.request_number DESC;
