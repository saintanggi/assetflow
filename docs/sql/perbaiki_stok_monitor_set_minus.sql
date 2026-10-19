-- perbaiki_stok_monitor_set_minus.sql
-- Perbaikan kasus: barang "MONITOR SET" masih MINUS di STOK-RETUR walaupun tiket
-- permintaannya sudah diubah menjadi "MONITOR".
--
-- KENAPA TERJADI
--   Mengubah Nama Barang pada tiket (Edit Item di halaman Permintaan) hanya
--   mengganti penunjuk barang di request_items. Transaksi OUT yang sudah
--   diposting tetap menempel di barang LAMA, jadi:
--       MONITOR SET  = -4  (menyimpan potongan yang seharusnya bukan miliknya)
--       MONITOR      = 22  (tidak pernah terpotong 4)
--   Ini bug aplikasi yang sudah diperbaiki (migrasi 20261019000037):
--   edit barang pada baris yang sudah terkirim kini memindahkan stok otomatis.
--
--   Untuk DATA YANG SUDAH TERLANJUR, pakai skrip ini sekali saja.
--
-- PRASYARAT
--   Jalankan dulu docs/sql/admin_change_request_item.sql (atau migrasi
--   20261019000037) supaya fungsi admin_move_stock_between_items tersedia.
--
-- CARA PAKAI
--   Supabase Dashboard -> SQL Editor -> New query.
--   1) Jalankan LANGKAH 1 & 2 untuk memastikan diagnosis benar.
--   2) Sesuaikan angka pada LANGKAH 3 (nama barang & qty), lalu Run.
--   3) Jalankan LANGKAH 4 untuk verifikasi.
--   Aman diulang: kunci idempotency mencegah pemindahan ganda.

-- ===========================================================================
-- LANGKAH 1 (baca saja): saldo semua lokasi untuk barang yang namanya mirip.
-- ===========================================================================
SELECT
  i.sku,
  i.name       AS barang,
  l.code       AS kode_lokasi,
  b.qty        AS saldo,
  CASE WHEN b.qty < 0 THEN 'NEGATIF' ELSE '' END AS catatan
FROM public.inventory_balances b
JOIN public.inventory_items i ON i.id = b.item_id
JOIN public.locations        l ON l.id = b.location_id
WHERE i.name ILIKE '%MONITOR%'
ORDER BY i.name, l.code;

-- ===========================================================================
-- LANGKAH 2 (baca saja): transaksi OUT yang membuat saldo minus + apakah
-- barangnya berbeda dengan barang di tiket sekarang.
-- ===========================================================================
SELECT
  t.doc_number,
  t.transaction_date,
  t.reference,
  l.code                                   AS lokasi_potong,
  ii.name                                  AS barang_di_transaksi,
  tii.qty                                  AS qty_dipotong,
  r.request_number,
  COALESCE(r.ticket_no, '-')               AS no_tiket,
  cur.barang_di_tiket                      AS barang_di_tiket_sekarang
FROM public.inventory_transaction_items tii
JOIN public.inventory_transactions t ON t.id = tii.transaction_id
JOIN public.inventory_items       ii ON ii.id = tii.item_id
LEFT JOIN public.locations        l  ON l.id = t.source_location_id
LEFT JOIN public.requests         r  ON 'REQ-KIRIM/' || r.request_number = t.reference
LEFT JOIN LATERAL (
  SELECT string_agg(mi.name, ', ' ORDER BY mi.name) AS barang_di_tiket
  FROM public.request_items ri
  JOIN public.inventory_items mi ON mi.id = ri.item_id
  WHERE ri.request_id = r.id
) cur ON true
WHERE t.type = 'out'
  AND t.status = 'posted'
  AND ii.name ILIKE '%MONITOR SET%'
ORDER BY t.transaction_date DESC, t.created_at DESC
LIMIT 50;

-- ===========================================================================
-- LANGKAH 3 (MENGUBAH DATA): pindahkan stok dari barang lama ke barang baru.
--
--   from  = barang yang salah menyimpan potongan (MONITOR SET)
--   to    = barang yang benar (MONITOR)
--   qty   = jumlah yang harusnya menempel di barang baru (contoh: 4)
--   lokasi= lokasi tempat saldo minus berada (contoh: STOK-RETUR)
--
--   Ganti angka '4' dan nama barang bila perlu. Jalankan SATU kali.
-- ===========================================================================
SELECT public.admin_move_stock_between_items(
  (SELECT id FROM public.inventory_items
    WHERE name ILIKE 'MONITOR SET' ORDER BY is_active DESC, name LIMIT 1),
  (SELECT id FROM public.locations WHERE code = 'STOK-RETUR' LIMIT 1),
  (SELECT id FROM public.inventory_items
    WHERE name ILIKE 'MONITOR' AND name NOT ILIKE '%SET%' ORDER BY is_active DESC, name LIMIT 1),
  (SELECT id FROM public.locations WHERE code = 'STOK-RETUR' LIMIT 1),
  4,
  'Perbaikan: tiket sudah diubah MONITOR SET -> MONITOR tetapi stok masih di barang lama',
  'KOREKSI-MONITOR-SET'
) AS hasil;

-- ===========================================================================
-- LANGKAH 4 (baca saja): verifikasi setelah koreksi.
--   MONITOR SET harus 0 (atau sesuai fisik), MONITOR berkurang sebanyak qty.
--   Dua transaksi koreksi baru terlihat di menu Log Transaksi.
-- ===========================================================================
SELECT
  i.name AS barang,
  l.code AS kode_lokasi,
  b.qty  AS saldo
FROM public.inventory_balances b
JOIN public.inventory_items i ON i.id = b.item_id
JOIN public.locations        l ON l.id = b.location_id
WHERE i.name ILIKE '%MONITOR%'
ORDER BY i.name, l.code;
