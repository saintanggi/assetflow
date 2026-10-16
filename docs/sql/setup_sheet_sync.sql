-- =============================================================================
-- SETUP SINKRONISASI GOOGLE SHEET — 1x copas (untuk Supabase SQL Editor)
-- =============================================================================
-- Cara pakai:
--   1. Buka https://supabase.com/dashboard → pilih project kamu
--   2. Menu kiri: SQL Editor → New query
--   3. Copas SELURUH isi file ini → klik RUN (kanan bawah)
--   4. Harus muncul "Success. No rows returned"
--
-- Isi file ini = gabungan dua migrasi repo:
--   • supabase/migrations/20261015000029_sheet_sync.sql
--   • supabase/migrations/20261015000030_sheet_sync_functions.sql
-- Aman dijalankan berulang kali (idempoten).
-- =============================================================================

-- =============================================================
-- 20261015000029 — Sinkronisasi otomatis dari Google Sheet
-- =============================================================
-- Tujuan: dokumen pengiriman yang diisi tim di Google Sheet
-- ("DOKUMEN PENGIRIMAN 2026" — satu sheet per tanggal) masuk ke sistem
-- TANPA upload manual. Sistem selalu membaca **sheet terbaru**.
--
-- Alur: Edge Function `sync-sheets` (dijadwalkan pg_cron / scheduler Supabase)
--  1. unduh file sebagai XLSX (link "Anyone with the link → Viewer"),
--  2. pilih sheet terbaru berdasarkan nama sheet bertanggal ("14 OKT"),
--  3. cocokkan nama barang dengan master + buang baris yang sudah pernah masuk,
--  4. buat permintaan + potong stok sesuai STATUS ASSET:
--     ASSET BARU → STOK-BARU, ASSET RETUR/RETURN → STOK-RETUR,
--     ASSET UNREADY → STOK-UNREADY (persis template dokumen pengiriman).
--
-- Tabel di bawah menyimpan konfigurasi sumber + riwayat jalan (audit).
-- =============================================================

CREATE TABLE IF NOT EXISTS public.sheet_sync_sources (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text        NOT NULL DEFAULT 'Dokumen Pengiriman',
  -- ID file Google Sheet (bagian di antara /d/ dan /edit pada URL).
  spreadsheet_id      text        NOT NULL,
  -- 'newest' = selalu sheet terbaru (default), 'named' = pakai kolom sheet_name.
  sheet_mode          text        NOT NULL DEFAULT 'newest'
                      CHECK (sheet_mode IN ('newest', 'named')),
  sheet_name          text,
  -- Opsi import (samakan dengan halaman Upload Dokumen).
  deduct_stock        boolean     NOT NULL DEFAULT true,
  allow_negative      boolean     NOT NULL DEFAULT true,
  auto_create_items   boolean     NOT NULL DEFAULT false,
  is_active           boolean     NOT NULL DEFAULT true,
  -- Status terakhir (diisi oleh Edge Function).
  last_sheet          text,
  last_run_at         timestamptz,
  last_status         text        CHECK (last_status IN ('sukses', 'gagal', 'sebagian')),
  last_message        text,
  last_requests       integer,
  last_items          integer,
  last_qty            numeric(18,3),
  created_by          uuid        REFERENCES public.profiles(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Satu file hanya boleh punya satu sumber aktif.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sheet_sync_source_file
  ON public.sheet_sync_sources(spreadsheet_id);

CREATE TABLE IF NOT EXISTS public.sheet_sync_runs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id         uuid        NOT NULL REFERENCES public.sheet_sync_sources(id) ON DELETE CASCADE,
  started_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  sheet_name        text,
  status            text        NOT NULL DEFAULT 'jalan'
                    CHECK (status IN ('jalan', 'sukses', 'gagal', 'sebagian')),
  requests_created  integer     NOT NULL DEFAULT 0,
  items_created     integer     NOT NULL DEFAULT 0,
  qty_imported      numeric(18,3) NOT NULL DEFAULT 0,
  rows_skipped_dup  integer     NOT NULL DEFAULT 0,
  message           text,
  detail            jsonb,
  triggered_by      text        NOT NULL DEFAULT 'cron'
                    CHECK (triggered_by IN ('cron', 'manual'))
);

CREATE INDEX IF NOT EXISTS idx_sheet_sync_runs_source
  ON public.sheet_sync_runs(source_id, started_at DESC);

-- ---------- RLS: hanya Super Admin / settings.manage ----------
ALTER TABLE public.sheet_sync_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sheet_sync_runs    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sheet_sync_sources_all ON public.sheet_sync_sources;
CREATE POLICY sheet_sync_sources_all ON public.sheet_sync_sources
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.has_permission('settings.manage'))
  WITH CHECK (public.is_super_admin() OR public.has_permission('settings.manage'));

DROP POLICY IF EXISTS sheet_sync_runs_select ON public.sheet_sync_runs;
CREATE POLICY sheet_sync_runs_select ON public.sheet_sync_runs
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.has_permission('settings.manage'));

-- Trigger updated_at.
CREATE OR REPLACE FUNCTION public.sheet_sync_sources_touch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sheet_sync_sources_touch ON public.sheet_sync_sources;
CREATE TRIGGER trg_sheet_sync_sources_touch
  BEFORE UPDATE ON public.sheet_sync_sources
  FOR EACH ROW EXECUTE FUNCTION public.sheet_sync_sources_touch();

-- ---------- Bantu: daftar permintaan yang dibuat dari sinkronisasi ----------
-- Kolom notes request sudah memuat sumber; view ini memudahkan audit.
CREATE OR REPLACE VIEW public.v_sheet_sync_recent AS
SELECT r.id,
       r.ticket_no,
       r.request_date,
       r.branch_name,
       r.status,
       SUM(ri.qty_approved) AS qty,
       COUNT(ri.id)         AS items,
       MIN(r.created_at)    AS created_at
FROM public.requests r
JOIN public.request_items ri ON ri.request_id = r.id
WHERE r.notes LIKE 'Sinkron Google Sheet%'
GROUP BY r.id, r.ticket_no, r.request_date, r.branch_name, r.status;

GRANT SELECT ON public.v_sheet_sync_recent TO authenticated;


-- =============================================================
-- Bagian 2 — fungsi khusus sinkronisasi Google Sheet
-- =============================================================
-- Edge Function `sync-sheets` berjalan dengan service_role (auth.uid() = NULL),
-- sehingga RPC ship_request_items() yang memakai has_permission() tidak bisa
-- dipakai. Fungsi ini isinya identik dengan ship_request_items versi terakhir
-- (20261016000032 / multi-lokasi): stok dipotong per STATUS ASSET item
-- (ASSET BARU -> STOK-BARU, ASSET RETUR/RETURN -> STOK-RETUR, UNREADY ->
-- STOK-UNREADY), p_location_id hanya fallback. Pengecekan izin ditambah
-- is_service_role() untuk Edge Function.

CREATE OR REPLACE FUNCTION public.is_service_role()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), auth.role()) = 'service_role'
$$;

GRANT EXECUTE ON FUNCTION public.is_service_role() TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.sync_ship_request_items(
  p_request_id     uuid,
  p_location_id    uuid,
  p_lines          jsonb,
  p_notes          text    DEFAULT NULL,
  p_allow_negative boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_req_status  text;
  v_req_number  text;
  v_req_date    date;
  v_branch_name text;
  v_txn_id      uuid;
  v_first_txn   uuid;
  v_line        jsonb;
  v_ri_id       uuid;
  v_qty         numeric;
  v_resi        text;
  v_item_id     uuid;
  v_approved    numeric;
  v_shipped     numeric;
  v_item_status text;
  v_status_aset text;
  v_norm_aset   text;
  v_loc_baru    uuid;
  v_loc_retur   uuid;
  v_loc_unready uuid;
  v_group_loc   uuid;
BEGIN
  -- Dipakai Edge Function sinkronisasi (service_role) dan tetap aman untuk
  -- pengguna biasa karena hak aksesnya sama seperti ship_request_items.
  IF NOT (
    public.is_super_admin()
    OR public.is_service_role()
    OR public.has_permission('requests.review')
    OR public.has_permission('requests.approve')
  ) THEN
    RAISE EXCEPTION 'Tidak punya izin mengirim permintaan';
  END IF;

  SELECT status, request_number, request_date, branch_name
    INTO v_req_status, v_req_number, v_req_date, v_branch_name
    FROM public.requests
   WHERE id = p_request_id
   FOR UPDATE;

  IF v_req_status IS NULL THEN
    RAISE EXCEPTION 'Permintaan tidak ditemukan';
  END IF;
  IF v_req_status NOT IN ('disetujui', 'disetujui_sebagian', 'diproses', 'selesai') THEN
    RAISE EXCEPTION 'Permintaan belum disetujui (status: %)', v_req_status;
  END IF;

  -- Lokasi stok per jenis (kode unik global). Fallback: p_location_id.
  SELECT id INTO v_loc_baru    FROM public.locations WHERE code = 'STOK-BARU'    AND is_active LIMIT 1;
  SELECT id INTO v_loc_retur   FROM public.locations WHERE code = 'STOK-RETUR'   AND is_active LIMIT 1;
  SELECT id INTO v_loc_unready FROM public.locations WHERE code = 'STOK-UNREADY' AND is_active LIMIT 1;

  CREATE TEMP TABLE tmp_ship_lines (
    item_id     uuid,
    qty         numeric,
    resi        text,
    status_aset text,
    location_id uuid
  ) ON COMMIT DROP;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_ri_id := (v_line->>'request_item_id')::uuid;
    v_qty   := (v_line->>'qty')::numeric;
    v_resi  := NULLIF(btrim(COALESCE(v_line->>'resi', '')), '');

    SELECT item_id, qty_approved, qty_shipped, item_status, status_aset
      INTO v_item_id, v_approved, v_shipped, v_item_status, v_status_aset
      FROM public.request_items
     WHERE id = v_ri_id AND request_id = p_request_id
     FOR UPDATE;

    IF v_item_id IS NULL THEN
      RAISE EXCEPTION 'Item permintaan tidak valid';
    END IF;
    IF v_approved IS NULL THEN
      RAISE EXCEPTION 'Item belum di-approve (id %)', v_ri_id;
    END IF;
    IF v_item_status NOT IN ('disetujui', 'diproses', 'siap', 'pending_sebagian') THEN
      RAISE EXCEPTION 'Item belum siap dikirim (status: %)', v_item_status;
    END IF;
    IF v_qty <= 0 OR v_qty > (v_approved - v_shipped) THEN
      RAISE EXCEPTION 'Qty kirim % melebihi sisa %', v_qty, (v_approved - v_shipped);
    END IF;

    v_norm_aset := CASE
      WHEN upper(COALESCE(v_status_aset, '')) LIKE '%UNREADY%' THEN 'UNREADY'
      WHEN upper(COALESCE(v_status_aset, '')) LIKE '%RETUR%'   THEN 'ASSET RETUR'
      ELSE 'ASSET BARU'
    END;

    -- Lokasi potong mengikuti jenis stok item, bukan pilihan tunggal pemanggil.
    v_group_loc := CASE v_norm_aset
      WHEN 'ASSET RETUR' THEN COALESCE(v_loc_retur, p_location_id)
      WHEN 'UNREADY'     THEN COALESCE(v_loc_unready, p_location_id)
      ELSE COALESCE(v_loc_baru, p_location_id)
    END;

    UPDATE public.request_items
       SET qty_shipped = qty_shipped + v_qty,
           resi        = COALESCE(v_resi, resi),
           item_status = CASE
             WHEN qty_shipped + v_qty >= qty_approved THEN 'terkirim'
             ELSE 'pending_sebagian'
           END,
           updated_at  = now()
     WHERE id = v_ri_id;

    INSERT INTO tmp_ship_lines VALUES (v_item_id, v_qty, v_resi, v_norm_aset, v_group_loc);
  END LOOP;

  -- Satu transaksi OUT per lokasi: tiap jenis stok terpotong dari lokasi yang benar.
  FOR v_group_loc IN SELECT DISTINCT location_id FROM tmp_ship_lines LOOP
    INSERT INTO public.inventory_transactions (
      type, status, transaction_date, source_location_id, notes, reference, created_by, posted_at
    )
    VALUES (
      'out', 'posted', COALESCE(v_req_date, CURRENT_DATE), v_group_loc, p_notes,
      'REQ-KIRIM/' || v_req_number, auth.uid(), now()
    )
    RETURNING id INTO v_txn_id;

    IF v_first_txn IS NULL THEN
      v_first_txn := v_txn_id;
    END IF;

    -- Agregasi per item_id dalam satu transaksi (hindari pelanggaran uq_txn_item).
    INSERT INTO public.inventory_transaction_items
      (transaction_id, item_id, qty, notes, resi, gerai, status_aset)
    SELECT
      v_txn_id,
      item_id,
      SUM(qty),
      'Kirim permintaan ' || v_req_number,
      NULLIF(STRING_AGG(DISTINCT resi, ', ' ORDER BY resi), ''),
      v_branch_name,
      MAX(status_aset)
    FROM tmp_ship_lines
    WHERE location_id = v_group_loc
    GROUP BY item_id;

    PERFORM public._apply_posted_effects(v_txn_id, p_allow_negative);
  END LOOP;

  DROP TABLE tmp_ship_lines;

  -- Update status header request secara akurat:
  -- 'selesai' hanya jika seluruh baris item sudah 'terkirim' atau 'ditolak'.
  UPDATE public.requests
     SET status = CASE
           WHEN NOT EXISTS (
             SELECT 1 FROM public.request_items
              WHERE request_id = p_request_id
                AND item_status NOT IN ('terkirim', 'ditolak')
           ) THEN 'selesai'
           WHEN EXISTS (
             SELECT 1 FROM public.request_items
              WHERE request_id = p_request_id
                AND item_status IN ('pending_sebagian', 'menunggu_stok')
           ) THEN 'disetujui_sebagian'
           ELSE 'diproses'
         END,
         updated_at = now()
   WHERE id = p_request_id;

  RETURN v_first_txn;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_ship_request_items(uuid, uuid, jsonb, text, boolean)
  TO service_role;
REVOKE ALL ON FUNCTION public.sync_ship_request_items(uuid, uuid, jsonb, text, boolean)
  FROM PUBLIC, anon, authenticated;

