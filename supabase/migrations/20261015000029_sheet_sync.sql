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
