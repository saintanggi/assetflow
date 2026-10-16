-- ===============================================================================
-- KOREKSI DATA: potongan stok salah lokasi (hasil Sinkron Google Sheet)
-- ===============================================================================
-- Masalah : barang keluar hasil sinkronisasi terpotong dari lokasi yang salah.
--           Contoh: di permintaan tertulis ASSET RETUR, tapi stok terpotong dari
--           STOK-BARU (seharusnya STOK-RETUR). Akibatnya saldo lokasi salah —
--           bisa minus / tidak sesuai dengan fisik.
-- Solusi  : script ini mendeteksi semua potongan yang salah, lalu membuat
--           transaksi TRANSFER penyeimbang (dari lokasi yang seharusnya
--           terpotong -> ke lokasi yang salah terpotong) memakai RPC resmi
--           post_inventory_transaction, sehingga ledger & audit tetap rapi.
--
-- Cara pakai:
--   1. Buka https://supabase.com/dashboard -> pilih project kamu
--   2. Menu kiri: SQL Editor -> New query
--   3. Copas SELURUH isi file ini -> klik RUN
--   4. Baca hasilnya:
--        a) Tabel HASIL DIAGNOSIS — daftar potongan salah + status koreksi.
--        b) Pesan NOTICE — ringkasan koreksi yang dijalankan/gagal.
--   5. Aman diulang: yang sudah dikoreksi tidak dikoreksi dua kali
--      (idempotency key). Yang gagal (mis. stok lokasi benar tidak cukup)
--      dilaporkan di NOTICE tanpa menghentikan baris lain.
--
-- Syarat: jalankan sebagai Super Admin / user berizin inventory.transfer.
-- ===============================================================================

-- ---------------------------------------------------------------------------
-- BAGIAN A — DIAGNOSIS (tabel sementara, dipakai Bagian B juga)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS _koreksi_mismatch;
CREATE TEMP TABLE _koreksi_mismatch AS
WITH base AS (
  SELECT
    ti.item_id,
    ii.sku,
    ii.name AS item_name,
    sl.code AS actual_loc,                       -- lokasi yang terpotong (salah)
    CASE
      WHEN upper(COALESCE(ti.status_aset, '')) LIKE '%UNREADY%' THEN 'STOK-UNREADY'
      WHEN upper(COALESCE(ti.status_aset, '')) LIKE '%RETUR%'
        OR upper(COALESCE(ti.status_aset, '')) LIKE '%RETURN%' THEN 'STOK-RETUR'
      ELSE 'STOK-BARU'
    END AS expected_loc,                        -- lokasi yang seharusnya terpotong
    SUM(ti.qty) AS qty_salah,
    string_agg(DISTINCT t.doc_number, ', ' ORDER BY t.doc_number) AS dokumen
  FROM public.inventory_transaction_items ti
  JOIN public.inventory_transactions t ON t.id = ti.transaction_id
  JOIN public.inventory_items ii ON ii.id = ti.item_id
  JOIN public.locations sl ON sl.id = t.source_location_id
  WHERE t.type = 'out'
    AND t.status = 'posted'
    AND ti.qty > 0
    AND ti.status_aset IS NOT NULL              -- hanya dari alur sinkron/upload
  GROUP BY ti.item_id, ii.sku, ii.name, sl.code, 5
)
SELECT
  b.sku,
  b.item_name,
  b.qty_salah,
  b.actual_loc  AS lokasi_salah_terpotong,
  b.expected_loc AS lokasi_seharusnya,
  (SELECT bl.qty FROM public.inventory_balances bl
     JOIN public.locations l2 ON l2.id = bl.location_id
    WHERE bl.item_id = b.item_id AND l2.code = b.actual_loc)   AS saldo_lokasi_salah_saat_ini,
  (SELECT bl.qty FROM public.inventory_balances bl
     JOIN public.locations l2 ON l2.id = bl.location_id
    WHERE bl.item_id = b.item_id AND l2.code = b.expected_loc) AS saldo_lokasi_benar_saat_ini,
  b.dokumen,
  b.item_id,
  EXISTS (
    SELECT 1 FROM public.inventory_transactions k
    WHERE k.idempotency_key =
          'koreksi-lokasi/' || b.item_id::text || '/' || b.actual_loc || '/' || b.expected_loc
  ) AS sudah_dikoreksi
FROM base b
WHERE b.actual_loc <> b.expected_loc
ORDER BY b.sku;

-- Tampilkan diagnosis ke user.
SELECT
  sku,
  item_name AS barang,
  qty_salah,
  lokasi_salah_terpotong AS terpotong_dari,
  lokasi_seharusnya      AS seharusnya_dari,
  saldo_lokasi_salah_saat_ini,
  saldo_lokasi_benar_saat_ini,
  dokumen,
  CASE WHEN sudah_dikoreksi THEN 'YA' ELSE 'BELUM' END AS sudah_dikoreksi
FROM _koreksi_mismatch;

-- ---------------------------------------------------------------------------
-- BAGIAN B — KOREKSI (transfer penyeimbang, idempoten)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r       RECORD;
  v_src   uuid;   -- lokasi yang seharusnya terpotong (sumber transfer)
  v_dst   uuid;   -- lokasi yang salah terpotong (tujuan transfer)
  v_doc   text;
  v_ok    int := 0;
  v_gagal int := 0;
BEGIN
  FOR r IN SELECT * FROM _koreksi_mismatch WHERE NOT sudah_dikoreksi LOOP
    SELECT id INTO v_src FROM public.locations WHERE code = r.lokasi_seharusnya;
    SELECT id INTO v_dst FROM public.locations WHERE code = r.lokasi_salah_terpotong;
    IF v_src IS NULL OR v_dst IS NULL THEN
      RAISE NOTICE 'GAGAL % (%): lokasi tidak ditemukan', r.sku, r.item_name;
      v_gagal := v_gagal + 1;
      CONTINUE;
    END IF;
    BEGIN
      v_doc := public.post_inventory_transaction(
        'koreksi-lokasi/' || r.item_id::text || '/' || r.lokasi_salah_terpotong || '/' || r.lokasi_seharusnya,
        'transfer',
        CURRENT_DATE,
        v_src,
        v_dst,
        'KOREKSI-LOKASI',
        'Koreksi potongan salah lokasi: ' || r.qty_salah::text || 'x ' || r.sku ||
        ' (' || r.item_name || ') seharusnya dipotong dari ' || r.lokasi_seharusnya ||
        ', bukan ' || r.lokasi_salah_terpotong || '. Dokumen asal: ' || r.dokumen,
        jsonb_build_array(jsonb_build_object(
          'item_id', r.item_id,
          'qty', r.qty_salah,
          'status_aset', CASE r.lokasi_seharusnya
                           WHEN 'STOK-RETUR' THEN 'ASSET RETUR'
                           WHEN 'STOK-UNREADY' THEN 'UNREADY'
                           ELSE 'ASSET BARU' END,
          'notes', 'Koreksi otomatis lokasi potong'
        ))
      );
      -- Idempoten: bila key sudah ada, RPC mengembalikan doc lama tanpa efek ganda.
      v_ok := v_ok + 1;
      RAISE NOTICE 'OK % | %s x % (%): % -> %', v_doc, r.qty_salah, r.sku, r.item_name,
        r.lokasi_seharusnya, r.lokasi_salah_terpotong;
    EXCEPTION WHEN OTHERS THEN
      v_gagal := v_gagal + 1;
      RAISE NOTICE 'GAGAL % (%): %', r.sku, r.item_name, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'SELESAI — berhasil: %, gagal: %.', v_ok, v_gagal;
  IF v_gagal > 0 THEN
    RAISE NOTICE 'Yang GAGAL biasanya karena stok di lokasi yang seharusnya tidak mencukupi. ' ||
      'Catat dulu barang masuk ke lokasi tersebut, lalu jalankan ulang script ini.';
  END IF;
END $$;

DROP TABLE IF EXISTS _koreksi_mismatch;
