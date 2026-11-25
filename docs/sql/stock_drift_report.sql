-- =============================================================
-- LAPORAN SELISIH STOK (drift) — hanya membaca
-- =============================================================
-- Menjawab: "selisih historis ini apa, berapa banyak, dan sejak kapan?"
--
-- drift = qty − (opening_qty + seluruh mutasi ledger)
--   drift = 0        → Stok Awal dasar cocok dengan riwayat
--   drift > 0        → saldo lebih besar dari riwayat (ada penambahan
--                      di luar ledger: data lama/impor/koreksi manual)
--   drift < 0        → saldo lebih kecil dari riwayat (pengurangan di luar
--                      ledger / ledger hilang)
--
-- CATATAN: drift TIDAK membuat laporan miring. Laporan (Live Stok) selalu
-- menghitung ulang Stok Awal dari saldo, sehingga Awal + Masuk − Keluar =
-- Akhir. Drift hanya menandai bahwa angka dasar "Stok Awal" tidak sama
-- dengan riwayat. Menjalankan "Selaraskan" TIDAK mengubah stok fisik.
-- =============================================================

-- -------------------------------------------------------------
-- A. RINGKASAN: berapa baris & berapa unit selisihnya
-- -------------------------------------------------------------
WITH d AS (
  SELECT
    b.item_id,
    b.location_id,
    b.qty,
    b.opening_qty,
    COALESCE(x.net, 0) AS ledger_net,
    b.qty - (b.opening_qty + COALESCE(x.net, 0)) AS drift,
    b.updated_at,
    (SELECT max(ld.created_at) FROM public.inventory_ledger ld
      WHERE ld.item_id = b.item_id AND ld.location_id = b.location_id) AS last_ledger_at
    FROM public.inventory_balances b
    LEFT JOIN LATERAL (
      SELECT SUM(ld.qty_change) AS net
        FROM public.inventory_ledger ld
       WHERE ld.item_id = b.item_id
         AND ld.location_id = b.location_id
    ) x ON true
)
SELECT
  count(*) FILTER (WHERE abs(drift) >= 0.0005)                      AS baris_selisih,
  COALESCE(sum(abs(drift)) FILTER (WHERE abs(drift) >= 0.0005), 0)  AS total_unit_selisih,
  count(*) FILTER (WHERE abs(drift) >= 0.0005
                     AND last_ledger_at IS NULL)                    AS tanpa_riwayat_ledger,
  count(*) FILTER (WHERE abs(drift) >= 0.0005
                     AND last_ledger_at IS NOT NULL
                     AND updated_at > last_ledger_at + interval '1 minute')
                                                                    AS diubah_setelah_ledger_terakhir,
  count(*)                                                          AS total_baris_saldo
  FROM d;

-- -------------------------------------------------------------
-- B. PER LOKASI: di mana selisih menumpuk
-- -------------------------------------------------------------
WITH d AS (
  SELECT
    l.code AS location_code,
    b.qty - (b.opening_qty + COALESCE(x.net, 0)) AS drift
    FROM public.inventory_balances b
    JOIN public.locations l ON l.id = b.location_id
    LEFT JOIN LATERAL (
      SELECT SUM(ld.qty_change) AS net
        FROM public.inventory_ledger ld
       WHERE ld.item_id = b.item_id
         AND ld.location_id = b.location_id
    ) x ON true
)
SELECT
  location_code,
  count(*) FILTER (WHERE abs(drift) >= 0.0005)                     AS baris_selisih,
  COALESCE(sum(abs(drift)) FILTER (WHERE abs(drift) >= 0.0005), 0) AS total_unit_selisih
  FROM d
 GROUP BY location_code
HAVING count(*) FILTER (WHERE abs(drift) >= 0.0005) > 0
 ORDER BY total_unit_selisih DESC;

-- -------------------------------------------------------------
-- C. DETAIL 50 SELISIH TERBESAR + jejak waktunya
-- -------------------------------------------------------------
WITH d AS (
  SELECT
    b.item_id,
    b.location_id,
    i.sku,
    i.name AS item_name,
    l.code AS location_code,
    b.qty,
    b.opening_qty,
    COALESCE(x.net, 0) AS ledger_net,
    b.qty - (b.opening_qty + COALESCE(x.net, 0)) AS drift,
    b.updated_at,
    (SELECT max(ld.created_at) FROM public.inventory_ledger ld
      WHERE ld.item_id = b.item_id AND ld.location_id = b.location_id) AS last_ledger_at
    FROM public.inventory_balances b
    JOIN public.inventory_items i ON i.id = b.item_id
    JOIN public.locations l ON l.id = b.location_id
    LEFT JOIN LATERAL (
      SELECT SUM(ld.qty_change) AS net
        FROM public.inventory_ledger ld
       WHERE ld.item_id = b.item_id
         AND ld.location_id = b.location_id
    ) x ON true
)
SELECT
  d.sku,
  d.item_name,
  d.location_code,
  d.qty,
  d.opening_qty,
  d.ledger_net,
  d.drift,
  d.updated_at AS saldo_diubah_terakhir,
  d.last_ledger_at AS ledger_terakhir,
  (SELECT a.created_at FROM public.audit_logs a
    WHERE a.entity_type = 'inventory_balances'
      AND a.entity_id = d.item_id::text
    ORDER BY a.created_at DESC LIMIT 1) AS audit_terakhir
  FROM d
 WHERE abs(d.drift) >= 0.0005
 ORDER BY abs(d.drift) DESC
 LIMIT 50;
