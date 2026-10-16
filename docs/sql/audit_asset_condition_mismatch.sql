-- DIAGNOSTIK READ-ONLY: cocokkan log pengiriman dengan status aset permintaan.
-- Menampilkan semua pengiriman posted yang jenis stok di request_items tidak
-- sama dengan lokasi stok yang benar-benar berkurang. Tidak mengubah data.
-- Jalankan di Supabase SQL Editor; gunakan hasilnya untuk koreksi di Log Transaksi
-- (aksi pensil, khusus Super Admin) agar saldo ledger dikoreksi dengan transfer audit.

WITH posted_shipments AS (
  SELECT
    t.id AS transaction_id,
    t.doc_number,
    t.transaction_date,
    t.reference,
    t.source_location_id,
    l.code AS actual_location,
    r.ticket_no,
    r.branch_name,
    ti.item_id,
    i.sku,
    i.name AS item_name,
    ti.qty,
    ti.status_aset AS transaction_status_aset,
    expected.expected_location,
    expected.request_status_aset,
    expected.status_count
  FROM public.inventory_transactions t
  JOIN public.inventory_transaction_items ti ON ti.transaction_id = t.id
  JOIN public.inventory_items i ON i.id = ti.item_id
  JOIN public.locations l ON l.id = t.source_location_id
  LEFT JOIN public.requests r
    ON t.reference = 'REQ-KIRIM/' || r.request_number
  LEFT JOIN LATERAL (
    SELECT
      count(DISTINCT mapped.location_code) AS status_count,
      min(mapped.location_code) AS expected_location,
      string_agg(DISTINCT mapped.raw_status, ', ' ORDER BY mapped.raw_status) AS request_status_aset
    FROM (
      SELECT
        ri.status_aset AS raw_status,
        CASE
          WHEN upper(COALESCE(ri.status_aset, '')) LIKE '%UNREADY%' THEN 'STOK-UNREADY'
          WHEN upper(COALESCE(ri.status_aset, '')) LIKE '%RETUR%'
            OR upper(COALESCE(ri.status_aset, '')) LIKE '%RETURN%' THEN 'STOK-RETUR'
          ELSE 'STOK-BARU'
        END AS location_code
      FROM public.request_items ri
      WHERE ri.request_id = r.id
        AND ri.item_id = ti.item_id
        AND ri.status_aset IS NOT NULL
    ) mapped
  ) expected ON true
  WHERE t.type = 'out'
    AND t.status = 'posted'
    AND t.reference LIKE 'REQ-KIRIM/%'
)
SELECT
  transaction_date AS tanggal,
  doc_number AS dokumen,
  reference AS referensi,
  ticket_no AS tiket,
  branch_name AS gerai,
  sku,
  item_name AS barang,
  qty,
  transaction_status_aset AS status_di_log,
  request_status_aset AS status_di_permintaan,
  actual_location AS stok_yang_berkurang,
  expected_location AS stok_yang_seharusnya,
  CASE WHEN status_count > 1 THEN 'PERLU CEK MANUAL: status barang ganda'
       ELSE 'MISMATCH' END AS hasil
FROM posted_shipments
WHERE status_count = 1
  AND actual_location <> expected_location
ORDER BY transaction_date DESC, gerai, tiket, sku;
