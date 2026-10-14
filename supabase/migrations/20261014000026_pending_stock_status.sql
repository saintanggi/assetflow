-- 20261014000026 — Status "menunggu_stok" untuk sisa permintaan yang belum disetujui
-- karena stok gudang kurang. Selisih qty (diminta - disetujui) otomatis jadi
-- baris pending yang muncul di Sisa Belum Terkirim.

ALTER TABLE public.request_items
  DROP CONSTRAINT IF EXISTS request_items_item_status_check;

ALTER TABLE public.request_items
  ADD CONSTRAINT request_items_item_status_check
  CHECK (item_status IN ('menunggu','disetujui','ditolak','diproses','siap','terkirim','pending_sebagian','menunggu_stok'));
