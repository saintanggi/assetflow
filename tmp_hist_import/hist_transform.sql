-- TRANSFORM: staging -> requests + request_items (HISTORIS, tanpa ubah stok)
-- 1) Buat item yang belum ada di master (SKU HIST-xxx)
INSERT INTO public.inventory_items (sku, name, unit_code, is_active, notes)
SELECT DISTINCT
  'HIST-' || substr(md5(upper(s.item_name)), 1, 8),
  s.item_name, 'PCS', true,
  'Auto-create dari import historis DOKUMEN_PENGIRIMAN Okt 2026'
FROM public.hist_staging s
WHERE NOT EXISTS (SELECT 1 FROM public.inventory_items ii WHERE upper(ii.name) = upper(s.item_name))
ON CONFLICT (sku) DO NOTHING;

-- 2) Insert requests (satu per grup)
INSERT INTO public.requests (ticket_no, request_date, branch_name, branch_code, status, notes, reviewed_at)
SELECT DISTINCT
  COALESCE(s.ticket_no, 'HIST-' || s.d::text || '-' || substr(md5(s.grp),1,6)),
  s.d, s.branch_name, s.branch_code,
  CASE WHEN bool_or(s.status_terkirim = 'PENDING') THEN 'disetujui_sebagian' ELSE 'selesai' END,
  'Import historis DOKUMEN_PENGIRIMAN (Jun-Okt 2026). Tidak mengubah stok.',
  now()
FROM public.hist_staging s
GROUP BY s.grp, s.ticket_no, s.d, s.branch_name, s.branch_code
ON CONFLICT DO NOTHING;

-- 3) Insert request_items
INSERT INTO public.request_items
  (request_id, item_id, qty_requested, qty_approved, qty_shipped,
   barcode, serial_number, item_type, status_aset, resi, item_status, notes)
SELECT
  r.id, ii.id, s.qty, s.qty,
  CASE WHEN s.status_terkirim = 'PENDING' THEN 0 ELSE s.qty END,
  s.barcode, NULL, s.type_barang, s.status_aset, s.resi,
  CASE WHEN s.status_terkirim = 'PENDING' THEN 'pending_sebagian' ELSE 'terkirim' END,
  trim(concat_ws(' | ',
    NULLIF('Ket: ' || s.keterangan, 'Ket: '),
    NULLIF('Status request: ' || s.status_request, 'Status request: ')))
FROM public.hist_staging s
JOIN public.inventory_items ii ON upper(ii.name) = upper(s.item_name)
JOIN public.requests r ON r.ticket_no = COALESCE(s.ticket_no, 'HIST-' || s.d::text || '-' || substr(md5(s.grp),1,6))
  AND r.request_date = s.d AND r.branch_name = s.branch_name
ON CONFLICT (request_id, item_id) DO NOTHING;

-- 4) Laporan verifikasi
SELECT 'requests' AS tabel, count(*) AS jml FROM public.requests WHERE notes LIKE 'Import historis%'
UNION ALL
SELECT 'request_items', count(*) FROM public.request_items ri
  JOIN public.requests r ON r.id = ri.request_id WHERE r.notes LIKE 'Import historis%'
UNION ALL
SELECT 'pending_sebagian', count(*) FROM public.request_items WHERE item_status = 'pending_sebagian';

-- 5) Bersihkan staging
DROP TABLE public.hist_staging;
