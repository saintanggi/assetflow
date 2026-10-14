-- 20261014000022 — Izinkan split item permintaan per satuan.
-- Drop unique constraint (request_id, item_id) agar 1 item bisa jadi
-- beberapa baris (1 baris = 1 satuan, masing-masing barcode/SN sendiri).

ALTER TABLE public.request_items
  DROP CONSTRAINT IF EXISTS uq_request_item;

CREATE INDEX IF NOT EXISTS idx_request_items_req_item
  ON public.request_items(request_id, item_id);
