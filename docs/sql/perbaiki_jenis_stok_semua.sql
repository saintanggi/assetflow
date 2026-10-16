-- ===============================================================================
-- PERBAIKAN LENGKAP: JENIS STOK ASSET BARU vs ASSET RETUR vs UNREADY
-- ===============================================================================
-- Masalah : permintaan memakai RETURN (ASSET RETUR) tetapi transaksinya
--           tercatat BARU dan stok terpotong dari STOK-BARU (bisa juga
--           sebaliknya, atau menyangkut UNREADY). Akibatnya:
--             - Log Transaksi membaca jenis yang salah,
--             - saldo Stok Barang Baru / Stok Barang Retur tidak sesuai fisik.
-- Solusi  : satu script yang:
--             LANGKAH 1  rapikan label status_aset di request_items (kanonis),
--             LANGKAH 2  isi status_aset yang kosong di item transaksi dari
--                        data permintaannya (via referensi REQ-KIRIM/...),
--             LANGKAH 3  deteksi SEMUA transaksi masuk/keluar yang lokasi
--                        stoknya tidak cocok dengan jenis asetnya,
--             LANGKAH 4  buat transaksi TRANSFER penyeimbang per selisih
--                        (langsung SQL — TANPA memanggil RPC ber-permission,
--                         supaya aman dijalankan dari SQL Editor),
--             LANGKAH 5  laporkan hasil + sisa yang masih perlu perhatian.
--
-- Cara pakai:
--   1. Buka https://supabase.com/dashboard -> pilih project
--   2. Menu kiri: SQL Editor -> New query
--   3. Copas SELURUH isi file ini -> klik RUN
--   4. Baca hasilnya: tabel diagnosis + pesan NOTICE ringkasan.
--   5. Aman diulang (idempoten): yang sudah benar dilewati, yang sudah
--      dikoreksi tidak dibuat dua kali (idempotency_key unik).
-- ===============================================================================

-- ------------------------------------------------------------------------------
-- LANGKAH 1 — Kanonisasi label status_aset di request_items
-- ------------------------------------------------------------------------------
-- Nilai lama bisa berupa teks bebas dari file Excel ("RETURN", "ASSET RETURN",
-- "retur", dll). Samakan ke tiga nilai kanonis: ASSET BARU / ASSET RETUR / UNREADY.
WITH dinormalisasi AS (
  SELECT id,
         CASE
           WHEN upper(COALESCE(status_aset, '')) LIKE '%UNREADY%'              THEN 'UNREADY'
           WHEN upper(COALESCE(status_aset, '')) LIKE '%RETUR%'
             OR upper(COALESCE(status_aset, '')) LIKE '%RETURN%'               THEN 'ASSET RETUR'
           WHEN upper(COALESCE(status_aset, '')) LIKE '%BARU%'
             OR upper(COALESCE(status_aset, '')) LIKE '%NEW%'                  THEN 'ASSET BARU'
           ELSE NULL
         END AS baru
  FROM public.request_items
  WHERE status_aset IS NOT NULL
)
UPDATE public.request_items ri
   SET status_aset = d.baru,
       updated_at  = now()
  FROM dinormalisasi d
 WHERE ri.id = d.id
   AND d.baru IS NOT NULL
   AND ri.status_aset <> d.baru;

-- ------------------------------------------------------------------------------
-- LANGKAH 2 — Isi status_aset yang kosong pada item transaksi (dari permintaan)
-- ------------------------------------------------------------------------------
-- Transaksi kirim permintaan menyimpan referensi "REQ-KIRIM/<nomor>". Bila kolom
-- status_aset di inventory_transaction_items masih NULL (data lama), ambil dari
-- request_items -- hanya bila semua baris permintaan barang itu sepakat.
WITH pasangan AS (
  SELECT
    ti.id            AS ti_id,
    MIN(ri.status_aset) AS s_min,
    MAX(ri.status_aset) AS s_max
  FROM public.inventory_transaction_items ti
  JOIN public.inventory_transactions t ON t.id = ti.transaction_id
  JOIN public.requests r ON r.request_number = replace(t.reference, 'REQ-KIRIM/', '')
  JOIN public.request_items ri ON ri.request_id = r.id AND ri.item_id = ti.item_id
  WHERE t.reference LIKE 'REQ-KIRIM/%'
    AND ti.status_aset IS NULL
    AND ri.status_aset IS NOT NULL
  GROUP BY ti.id
  HAVING MIN(ri.status_aset) = MAX(ri.status_aset)
)
UPDATE public.inventory_transaction_items ti
   SET status_aset = p.s_min,
       updated_at  = now()
  FROM pasangan p
 WHERE ti.id = p.ti_id;

-- ------------------------------------------------------------------------------
-- LANGKAH 3+4 — Diagnosis & koreksi lokasi yang tidak cocok dengan jenis aset
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  v_kode   record;
  v_txn_id uuid;
  v_doc    text;
  v_from   uuid;
  v_to     uuid;
  v_aset   text;
  v_aktual text;
  v_ok     int := 0;
  v_skip   int := 0;
  v_gagal  int := 0;
BEGIN
  FOR v_kode IN
    WITH expected AS (
      SELECT
        t.id            AS txn_id,
        ti.id           AS ti_id,
        ti.item_id,
        ti.qty,
        t.type          AS txn_type,
        t.doc_number,
        t.reference,
        COALESCE(
          NULLIF(ti.status_aset, ''),
          'ASSET BARU'   -- tanpa label: jenis stok default = BARU
        )               AS status_aset,
        CASE
          WHEN upper(COALESCE(ti.status_aset, '')) LIKE '%UNREADY%' THEN 'STOK-UNREADY'
          WHEN upper(COALESCE(ti.status_aset, '')) LIKE '%RETUR%'   THEN 'STOK-RETUR'
          ELSE 'STOK-BARU'
        END             AS kode_harus,
        CASE WHEN t.type = 'out' THEN sl.code ELSE dl.code END AS kode_aktual
      FROM public.inventory_transaction_items ti
      JOIN public.inventory_transactions t ON t.id = ti.transaction_id
      LEFT JOIN public.locations sl ON sl.id = t.source_location_id
      LEFT JOIN public.locations dl ON dl.id = t.dest_location_id
      WHERE t.status = 'posted'
        AND t.type IN ('in', 'out')
        AND ti.qty > 0
    )
    SELECT * FROM expected e
    WHERE EXISTS (SELECT 1 FROM public.locations l WHERE l.code = e.kode_harus AND l.is_active)
      AND e.kode_aktual IS DISTINCT FROM e.kode_harus
      AND NOT EXISTS (   -- idempoten: selisih ini sudah pernah dikoreksi
        SELECT 1 FROM public.inventory_transactions k
         WHERE k.idempotency_key = 'koreksi-jenis-stok/' || e.txn_id::text || '/' || e.item_id::text
      )
    ORDER BY e.txn_id, e.item_id
  LOOP
    -- Jenis transaksi 'in'  : stok seharusnya masuk ke lokasi jenis asetnya
    --                         (salah masuk -> pindahkan ke lokasi yang benar).
    -- Jenis transaksi 'out' : stok seharusnya keluar dari lokasi jenis asetnya
    --                         (salah potong -> pindahkan dari lokasi yang benar).
    IF v_kode.txn_type = 'out' THEN
      v_from := (SELECT id FROM public.locations WHERE code = v_kode.kode_harus  LIMIT 1);
      v_to   := (SELECT id FROM public.locations WHERE code = v_kode.kode_aktual LIMIT 1);
    ELSE
      v_from := (SELECT id FROM public.locations WHERE code = v_kode.kode_aktual LIMIT 1);
      v_to   := (SELECT id FROM public.locations WHERE code = v_kode.kode_harus  LIMIT 1);
    END IF;

    IF v_from IS NULL OR v_to IS NULL OR v_from = v_to THEN
      v_skip := v_skip + 1;
      CONTINUE;
    END IF;

    v_aset   := CASE
                  WHEN v_kode.kode_harus = 'STOK-RETUR'   THEN 'ASSET RETUR'
                  WHEN v_kode.kode_harus = 'STOK-UNREADY' THEN 'UNREADY'
                  ELSE 'ASSET BARU'
                END;
    v_aktual := v_kode.kode_aktual;

    BEGIN
      INSERT INTO public.inventory_transactions (
        type, status, transaction_date,
        source_location_id, dest_location_id,
        reference, notes, idempotency_key, posted_at
      )
      VALUES (
        'transfer', 'posted', CURRENT_DATE,
        v_from, v_to,
        'KOREKSI-JENIS-STOK',
        'Koreksi jenis stok: ' || v_kode.qty::text || 'x ' || v_kode.status_aset ||
          ' seharusnya ' || CASE WHEN v_kode.txn_type = 'out' THEN 'keluar dari ' ELSE 'masuk ke ' END ||
          v_kode.kode_harus || ', tercatat ' ||
          CASE WHEN v_kode.txn_type = 'out' THEN 'keluar dari ' ELSE 'masuk ke ' END ||
          v_aktual || '. Dokumen asal: ' || v_kode.doc_number ||
          COALESCE(' (' || v_kode.reference || ')', ''),
        'koreksi-jenis-stok/' || v_kode.txn_id::text || '/' || v_kode.item_id::text,
        now()
      )
      RETURNING id, doc_number INTO v_txn_id, v_doc;

      INSERT INTO public.inventory_transaction_items
        (transaction_id, item_id, qty, notes, status_aset)
      VALUES (
        v_txn_id, v_kode.item_id, v_kode.qty,
        'Koreksi jenis stok dok ' || v_kode.doc_number || ': ' || v_aktual || ' -> ' || v_kode.kode_harus,
        v_aset
      );

      -- allow_negative = true: koreksi menutup selisih walau lokasi tujuan
      -- sementara minus (menandakan ada penerimaan yang belum dicatat).
      PERFORM public._apply_posted_effects(v_txn_id, true);

      -- Samakan label di baris dokumen asal supaya Log Transaksi konsisten.
      UPDATE public.inventory_transaction_items
         SET status_aset = v_aset,
             updated_at  = now()
       WHERE id = v_kode.ti_id
         AND COALESCE(status_aset, '') <> v_aset;

      v_ok := v_ok + 1;
      RAISE NOTICE 'OK  % | % x "%" : % -> % (dok asal %)',
        v_doc, v_kode.qty, v_kode.status_aset, v_aktual, v_kode.kode_harus, v_kode.doc_number;
    EXCEPTION WHEN OTHERS THEN
      v_gagal := v_gagal + 1;
      RAISE NOTICE 'GAGAL dok % item % : %', v_kode.doc_number, v_kode.item_id, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE '=== SELESAI — koreksi baru: %, dilewati (sudah benar/pernah dikoreksi): %, gagal: % ===',
    v_ok, v_skip, v_gagal;
  RAISE NOTICE 'Jalankan ulang script ini kapan saja — yang sudah benar tidak disentuh lagi.';
END $$;

-- ------------------------------------------------------------------------------
-- LANGKAH 5 — Sisa selisih (harus kosong bila semua koreksi berhasil)
-- ------------------------------------------------------------------------------
SELECT
  t.doc_number                              AS dokumen,
  t.type                                    AS jenis_txn,
  ii.sku,
  ii.name                                   AS barang,
  ti.qty,
  COALESCE(NULLIF(ti.status_aset, ''), '(kosong=BARU)') AS status_aset,
  CASE WHEN t.type = 'out' THEN sl.code ELSE dl.code END AS lokasi_tercatat,
  CASE
    WHEN upper(COALESCE(ti.status_aset, '')) LIKE '%UNREADY%' THEN 'STOK-UNREADY'
    WHEN upper(COALESCE(ti.status_aset, '')) LIKE '%RETUR%'   THEN 'STOK-RETUR'
    ELSE 'STOK-BARU'
  END                                       AS lokasi_seharusnya
FROM public.inventory_transaction_items ti
JOIN public.inventory_transactions t ON t.id = ti.transaction_id
JOIN public.inventory_items ii ON ii.id = ti.item_id
LEFT JOIN public.locations sl ON sl.id = t.source_location_id
LEFT JOIN public.locations dl ON dl.id = t.dest_location_id
WHERE t.status = 'posted'
  AND t.type IN ('in', 'out')
  AND ti.qty > 0
  AND NOT EXISTS (   -- abaikan yang sudah pernah dikoreksi oleh script ini
    SELECT 1 FROM public.inventory_transactions k
     WHERE k.idempotency_key = 'koreksi-jenis-stok/' || t.id::text || '/' || ti.item_id::text
  )
  AND EXISTS (SELECT 1 FROM public.locations l
               WHERE l.code = CASE
                 WHEN upper(COALESCE(ti.status_aset, '')) LIKE '%UNREADY%' THEN 'STOK-UNREADY'
                 WHEN upper(COALESCE(ti.status_aset, '')) LIKE '%RETUR%'   THEN 'STOK-RETUR'
                 ELSE 'STOK-BARU'
               END AND l.is_active)
  AND (CASE WHEN t.type = 'out' THEN sl.code ELSE dl.code END)
      IS DISTINCT FROM
      (CASE
         WHEN upper(COALESCE(ti.status_aset, '')) LIKE '%UNREADY%' THEN 'STOK-UNREADY'
         WHEN upper(COALESCE(ti.status_aset, '')) LIKE '%RETUR%'   THEN 'STOK-RETUR'
         ELSE 'STOK-BARU'
       END)
ORDER BY t.transaction_date, t.doc_number;
