# 📋 COPAS KE SUPABASE — 3 SCRIPT SIAP PAKAI

> File ini dibuat supaya Anda **tidak perlu mencari-cari lagi**. Isinya **3 script**:
> **BLOK A** (Langkah 1), **BLOK B** (Langkah 2), dan **BLOK C** (Langkah 4).
> Cara pakai: pilih script yang sesuai langkah → **Ctrl+A lalu Ctrl+C di dalam kotak itu saja**
> (dari kata `COPAS MULAI` sampai `COPAS SELESAI`) → paste ke Supabase → klik Run/Deploy.
>
> Panduan klik-per-klik lengkapnya: **`PANDUAN-SETUP-SINKRON.md`**.
> Cara memastikan sinkron benar-benar jalan: **`CEK-SINKRON.md`**.

| Blok | Dipakai di langkah | Ditempel di | Ukuran |
|---|---|---|---|
| **BLOK A** — tabel & fungsi database | Langkah 1 | Supabase → **SQL Editor** → New query → Run | 338 baris |
| **BLOK B** — mesin sinkron (Edge Function) | Langkah 2 | Supabase → **Edge Functions** → Create function `sync-sheets` → Deploy | 1335 baris |
| **BLOK C** — jadwal otomatis tiap 15 menit | Langkah 4 | Supabase → **SQL Editor** → New query → Run (ganti 2 tulisan dulu) | 46 baris |

**Alur singkat:** A dulu → B → (buka aplikasi: Tes koneksi, Simpan, Pratinjau, Sinkron sekarang) → C → Merge PR #4 → cek di `CEK-SINKRON.md`.

---
---

# 🟦 BLOK A — untuk LANGKAH 1 (Supabase → SQL Editor)

**Cara:** Supabase Dashboard → pilih project → menu kiri **`</>` SQL Editor** → **`+ New query`** → copas semua di bawah ini → klik **`Run`**.
**Harus muncul:** `Success. No rows returned`. (Aman diulang, tidak merusak data.)

<!-- COPAS MULAI (BLOK A) -->
```sql
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
```
<!-- COPAS SELESAI (BLOK A) -->

---
---

# 🟩 BLOK B — untuk LANGKAH 2 (Supabase → Edge Functions)

**Cara:** Supabase Dashboard → menu kiri **`Edge Functions`** → **`Create a new function`** → Name: **`sync-sheets`** → hapus semua contoh kode yang muncul → copas semua di bawah ini → biarkan **Enforce JWT Verification tetap ON** → klik **`Deploy`** → tunggu status **Deployed**.
**Catatan:** kalau di editor muncul garis merah/kuning, **abaikan saja** — itu normal untuk file besar; yang penting Deploy berhasil.
**Kalau Langkah 2 sudah pernah Anda kerjakan sebelumnya:** klik fungsi `sync-sheets` → **Edit** → hapus semua → paste ulang isi terbaru di bawah → **Deploy** (supaya perbaikan tanggal baris tanpa tanggal ikut terpakai).

<!-- COPAS MULAI (BLOK B) -->
```ts
// =============================================================================
// SINCRONISASI GOOGLE SHEET → SISTEM (versi SATU FILE)
// =============================================================================
// File ini dihasilkan otomatis oleh: npm run bundle:sync-fn
// JANGAN edit di sini — edit supabase/functions/sync-sheets/*.ts lalu jalankan ulang.
//
// Cara pakai (tanpa install apa pun):
//   Supabase Dashboard → Edge Functions → Create a new function
//   → Name: sync-sheets → Copas SELURUH isi file ini → Deploy
//
// Isi: helper unduh Google Sheet + parser dokumen pengiriman + handler HTTP.
// =============================================================================
import * as XLSX from "npm:xlsx@0.18.5";

// ============================== googleSheet.ts ==============================
// Unduh Google Sheet sebagai XLSX tanpa API key.
// Syarat: file di-share "Anyone with the link → Viewer" (atau dipublikasikan).
// Catatan: file gabungan (satu sheet per tanggal) HARUS diunduh sebagai XLSX
// supaya semua sheet bisa dibaca; endpoint CSV/gviz hanya memberi satu sheet.


/** Ambil ID spreadsheet dari URL lengkap atau ID mentah. */
export function extractSpreadsheetId(input: string): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  const url = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]{20,})/);
  if (url) return url[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(raw)) return raw;
  return null;
}

export async function downloadWorkbook(spreadsheetId: string): Promise<XLSX.WorkBook> {
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`;
  const res = await fetch(url, { redirect: "follow" });
  const contentType = res.headers.get("content-type") ?? "";
  const body = new Uint8Array(await res.arrayBuffer());

  if (!res.ok || contentType.includes("text/html")) {
    throw new Error(
      "File Google Sheet tidak bisa diunduh. Pastikan sharing diatur " +
        '"Anyone with the link → Viewer" (Bagikan → Siapa saja yang memiliki link → Pelihat), ' +
        "lalu coba lagi."
    );
  }
  try {
    return XLSX.read(body, { cellDates: true });
  } catch {
    throw new Error("Isi file bukan Excel yang valid (mungkin link salah atau file diproteksi).");
  }
}


// ============================ shippingUpload.ts =============================
// =============================================================================
// Logika baca & agregasi file "Dokumen Pengiriman" (menu Upload Dokumen).
//
// Dipisah dari komponen halaman supaya bisa diuji (src/lib/shippingUpload.test.ts).
//
// Perbaikan bug penting yang ditangani di sini:
// 1. QTY membengkak (contoh nyata: 23 jadi 45).
//    File pengiriman sering hanya mengisi kolom QTY pada baris pertama sebuah
//    blok (satu sel QTY di-merge untuk beberapa baris / beberapa resi), baris
//    lanjutannya kosong. Kode lama mengubah setiap baris tanpa QTY menjadi 1
//    sehingga total = QTY eksplisit + jumlah baris kosong (23 + 22 = 45).
//    Aturan baru:
//      - QTY berisi angka > 0            -> dipakai apa adanya (otoritatif),
//      - QTY kosong + ada BARCODE        -> 1 unit (satu fisik barang),
//      - QTY kosong + tanpa BARCODE      -> 0, baris hanya membawa RESI/KETERANGAN,
//      - satu grup tidak punya QTY sama sekali -> qty = jumlah baris (perilaku lama,
//        ditandai `qtyFromRowCount` supaya bisa diperingatkan ke pengguna).
// 2. Tanggal bergeser 1 hari di zona WIB/UTC+7 (Excel mengembalikan tengah malam
//    waktu lokal, kode lama memakai toISOString() yang mengonversi ke UTC).
// 3. Tanggal teks seperti "14-Oct-26" / "14/10/2026" dulu jatuh ke tanggal hari ini.
// 4. Deteksi duplikat: baris tanpa BARCODE (mis. baris resi) dulu tidak pernah
//    dianggap duplikat sehingga upload ulang file yang sama menggandakan qty.
// =============================================================================

export const SHIPPING_HEADERS = [
  "In Progress Date",
  "NO TICKET",
  "CABANG/GERAI",
  "KODE GERAI",
  "NAMA BARANG",
  "QTY",
  "KETERANGAN",
  "RESI",
  "BARCODE",
  "TYPE BARANG",
  "STATUS REQUEST",
  "STATUS ASSET",
  "STATUS TERKIRIM",
] as const;

/** Lokasi stok kanonis per kondisi aset. */
export type KodeKondisi = "STOK-BARU" | "STOK-RETUR" | "STOK-UNREADY";

export interface ParsedShippingRow {
  /** Nomor baris asli di Excel (1-based) — dipakai untuk pesan peringatan. */
  rowNo: number;
  date: string;
  /** false bila kolom In Progress Date kosong (dipakai tanggal hari ini). */
  dateExplicit: boolean;
  ticket: string;
  branch: string;
  branchCode: string;
  itemName: string;
  /** Qty efektif baris ini (0 = baris lanjutan yang hanya membawa resi/keterangan). */
  qty: number;
  /** true bila kolom QTY memang diisi angka > 0 di file. */
  qtyExplicit: boolean;
  /** true bila kolom QTY diisi tapi tidak terbaca sebagai angka. */
  qtyUnreadable: boolean;
  hasBarcode: boolean;
  ket: string;
  resi: string;
  barcode: string;
  typeBarang: string;
  statusRequest: string;
  statusAset: string;
  terkirim: string;
}

export interface AggLine {
  /** Kunci barang yang dipakai pengelompokan (nama barang atau id barang). */
  itemKey: string;
  itemName: string;
  kodeKondisi: KodeKondisi;
  isPending: boolean;
  /** Jumlah unit final yang dipakai sistem. */
  qty: number;
  /** Sumber angka qty — ditampilkan di pratinjau supaya bisa dicek. */
  qtySource: "qty-kolom" | "barcode" | "jumlah-baris" | "alokasi";
  /** Bagian angka QTY file yang jatuh ke baris-baris ini (0 bila kolom QTY kosong). */
  qtyFile: number;
  /** Jumlah barcode/unit unik pada baris-baris ini (tiap barcode = 1 unit). */
  qtyBarcode: number;
  /** Jumlah baris data pada blok ini. */
  rowCount: number;
  /** Jumlah baris tanpa QTY & tanpa BARCODE (baris lanjutan blok ber-QTY). */
  blankQtyRows: number;
  rows: ParsedShippingRow[];
}

export interface ParsedSheet {
  headerIndex: number;
  rows: ParsedShippingRow[];
}

// ---------------------------------------------------------------- util dasar

/** Pecah sel yang menyimpan beberapa nilai per baris (hasil agregasi upload). */
const splitText = (v: string | null | undefined): string[] =>
  (v ?? "").split("\n").map((s) => s.trim()).filter(Boolean);

export const toText = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  return String(v).trim();
};

/** Kode/nomor (resi, barcode, kode gerai) — angka besar tidak boleh jadi notasi ilmiah. */
export const toCode = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") return Number.isInteger(v) ? v.toFixed(0) : String(v);
  return String(v).trim();
};

const pad2 = (n: number): string => String(n).padStart(2, "0");
const round3 = (n: number): number => Math.round(n * 1000) / 1000;
export const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, agu: 8, aug: 8,
  sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, des: 12,
};

const isoOf = (y: number, m: number, d: number): string | null => {
  if (!(y > 1900 && y < 2200) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
};

const fullYear = (y: number): number => (y < 100 ? 2000 + y : y);

/** "14-Oct-26", "14/10/2026", "2026-10-14", "20261014" -> "YYYY-MM-DD". */
export function parseDateText(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return isoOf(Number(m[1]), Number(m[2]), Number(m[3]));
  m = t.match(/^(\d{8})$/);
  if (m) return isoOf(Number(t.slice(0, 4)), Number(t.slice(4, 6)), Number(t.slice(6, 8)));
  m = t.match(/^(\d{1,2})[-/.\s]+([A-Za-z]{3,})[-/.\s]+(\d{2,4})/);
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo) return isoOf(fullYear(Number(m[3])), mo, Number(m[1]));
  }
  m = t.match(/^([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo) return isoOf(Number(m[3]), mo, Number(m[2]));
  }
  // Format Indonesia dd/mm/yyyy (hari dulu).
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) return isoOf(fullYear(Number(m[3])), Number(m[2]), Number(m[1]));
  return null;
}

/**
 * Tanggal dari sel Excel. PENTING: jangan pakai toISOString() — untuk pengguna
 * WIB (UTC+7) tanggal 14-10 lokal jadi 13-10 UTC sehingga request_date bergeser.
 */
/** Sama seperti parseSheetDate, tetapi null bila sel tanggalnya kosong/tidak valid. */
export function parseSheetDateOrNull(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return isoOf(v.getFullYear(), v.getMonth() + 1, v.getDate());
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return isoOf(d.y, d.m, d.d);
  }
  return parseDateText(toText(v));
}

export function parseSheetDate(v: unknown, fallback: string = todayIso()): string {
  return parseSheetDateOrNull(v) ?? fallback;
}

/** Angka dari sel: 23 / "23" / "23 unit" / "1.234" (ribuan) / "23,5". */
export function parseNumberLike(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.replace(/[\s\u00a0]/g, "");
  if (!s) return null;
  // "1.234" (pemisah ribuan gaya Indonesia) harus dicek sebelum desimal.
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ""));
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^-?\d+(,\d+)?$/.test(s)) return Number(s.replace(",", "."));
  const m = s.match(/^-?\d+(?:[.,]\d+)?/);
  return m ? Number(m[0].replace(",", ".")) : null;
}

/**
 * Qty satu baris.
 * - angka > 0        -> dipakai (otoritatif)
 * - kosong + barcode -> 1
 * - kosong tanpa barcode -> 0 (baris lanjutan: hanya resi/keterangan)
 */
export function parseQtyCell(v: unknown, hasBarcode: boolean): { qty: number; explicit: boolean; unreadable: boolean } {
  const num = parseNumberLike(v);
  if (num !== null && num > 0) return { qty: round3(num), explicit: true, unreadable: false };
  // Angka 0 atau sel kosong diperlakukan sama: baris lanjutan (0) atau
  // 1 unit bila baris itu membawa BARCODE sendiri.
  if (num !== null) return { qty: hasBarcode ? 1 : 0, explicit: false, unreadable: false };
  const raw = toText(v);
  if (!raw) return { qty: hasBarcode ? 1 : 0, explicit: false, unreadable: false };
  return { qty: hasBarcode ? 1 : 0, explicit: false, unreadable: true };
}

// ---------------------------------------------------------------- baca sheet

export function findHeaderRow(aoa: unknown[][]): number {
  const idx = aoa.findIndex((r) => Array.isArray(r) && r.some((c) => toText(c).toUpperCase() === "NAMA BARANG"));
  return idx >= 0 ? idx : 0;
}

/** Apakah sheet ini berisi tabel dokumen pengiriman (punya kolom NAMA BARANG)? */
export function hasShippingHeader(aoa: unknown[][]): boolean {
  return aoa.some((r) => Array.isArray(r) && r.some((c) => toText(c).toUpperCase() === "NAMA BARANG"));
}

export interface SheetCandidate {
  name: string;
  rows: ParsedShippingRow[];
}

export interface WorkbookParse {
  /** Sheet yang berisi tabel pengiriman + minimal 1 baris data. */
  sheets: SheetCandidate[];
  /** Sheet lain (kosong / bukan tabel pengiriman). */
  skipped: { name: string; reason: string }[];
}

/**
 * Baca semua sheet di workbook dan kembalikan yang berisi data pengiriman.
 * Penting untuk file gabungan (mis. "DOKUMEN PENGIRIMAN 2026" yang punya satu
 * sheet per tanggal): sheet pertama belum tentu berisi data yang mau di-upload.
 */
export function parseWorkbook(wb: {
  SheetNames: string[];
  Sheets: Record<string, unknown>;
}): WorkbookParse {
  const sheets: SheetCandidate[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets?.[name];
    if (!ws) {
      skipped.push({ name, reason: "sheet kosong" });
      continue;
    }
    let aoa: unknown[][];
    try {
      aoa = XLSX.utils.sheet_to_json<unknown[]>(ws as XLSX.WorkSheet, { header: 1, defval: "" });
    } catch {
      skipped.push({ name, reason: "gagal dibaca" });
      continue;
    }
    if (aoa.length < 2 || !hasShippingHeader(aoa)) {
      skipped.push({ name, reason: "bukan tabel pengiriman" });
      continue;
    }
    const rows = parseShippingSheet(aoa).rows;
    if (rows.length === 0) {
      skipped.push({ name, reason: "tidak ada baris data" });
      continue;
    }
    sheets.push({ name, rows });
  }
  return { sheets, skipped };
}

export function parseShippingSheet(aoa: unknown[][]): ParsedSheet {
  const headerIndex = findHeaderRow(aoa);
  const headers = (aoa[headerIndex] ?? []).map((c) => toText(c).toUpperCase());
  const col = (...names: string[]): number => {
    for (const n of names) {
      const i = headers.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const cDate = col("IN PROGRESS DATE", "TANGGAL");
  const cTicket = col("NO TICKET");
  const cBranch = col("CABANG/GERAI", "GERAI");
  const cBranchCode = col("KODE GERAI");
  const cItem = col("NAMA BARANG");
  const cQty = col("QTY");
  const cKet = col("KETERANGAN");
  const cResi = col("RESI");
  const cBarcode = col("BARCODE");
  const cType = col("TYPE BARANG");
  const cStatusReq = col("STATUS REQUEST");
  const cStatusAset = col("STATUS ASSET");
  const cTerkirim = col("STATUS TERKIRIM");

  if (cItem < 0) {
    throw new Error("Kolom NAMA BARANG tidak ditemukan. Pakai template yang disediakan.");
  }

  const cell = (r: unknown[], c: number): unknown => (c >= 0 ? r[c] : "");
  const rows: ParsedShippingRow[] = [];
  for (let i = headerIndex + 1; i < aoa.length; i++) {
    const r = aoa[i];
    if (!Array.isArray(r)) continue;
    const itemName = toText(cell(r, cItem));
    if (!itemName || itemName.toUpperCase() === "NAMA BARANG") continue;
    const barcode = toCode(cell(r, cBarcode));
    const qtyParsed = parseQtyCell(cell(r, cQty), Boolean(barcode));
    const tanggal = cDate >= 0 ? parseSheetDateOrNull(cell(r, cDate)) : null;
    rows.push({
      rowNo: i + 1,
      date: tanggal ?? todayIso(),
      dateExplicit: tanggal !== null,
      ticket: toText(cell(r, cTicket)),
      branch: toText(cell(r, cBranch)) || "TANPA GERAI",
      branchCode: toCode(cell(r, cBranchCode)),
      itemName,
      qty: qtyParsed.qty,
      qtyExplicit: qtyParsed.explicit,
      qtyUnreadable: qtyParsed.unreadable,
      hasBarcode: Boolean(barcode),
      ket: toText(cell(r, cKet)),
      resi: toCode(cell(r, cResi)),
      barcode,
      typeBarang: toText(cell(r, cType)),
      statusRequest: toText(cell(r, cStatusReq)),
      statusAset: toText(cell(r, cStatusAset)),
      terkirim: toText(cell(r, cTerkirim)).toUpperCase(),
    });
  }
  return { headerIndex, rows };
}

// ---------------------------------------------------------------- agregasi

export function kondisiOf(statusAset: string | null | undefined): KodeKondisi {
  const s = toText(statusAset).toUpperCase();
  if (s.includes("RETUR") || s.includes("RETURN")) return "STOK-RETUR";
  if (s.includes("UNREADY")) return "STOK-UNREADY";
  return "STOK-BARU";
}

export const asetLabelOf = (kode: KodeKondisi): string =>
  kode === "STOK-RETUR" ? "ASSET RETUR" : kode === "STOK-UNREADY" ? "ASSET UNREADY" : "ASSET BARU";

/**
 * Nilai Status Aset KANONIS yang disimpan ke `request_items.status_aset`
 * (harus salah satu dari: ASSET BARU / ASSET RETUR / UNREADY).
 *
 * Dipakai saat menulis baris hasil import dokumen pengiriman supaya label yang
 * tersimpan selalu kanonis — bukan teks mentah file (mis. "RETURN",
 * "ASSET RETURN", "retur"). Label kanonis membuat:
 *  - RPC pengiriman memotong lokasi yang benar (STOK-RETUR, bukan STOK-BARU),
 *  - Log Transaksi menampilkan jenis yang konsisten,
 *  - koreksi jenis stok (admin_correct_txn_item) idempoten.
 * Sumber kebenarannya kode kondisi lokasi hasil agregasi (`kondisiOf`), jadi
 * label yang disimpan PASTI sama dengan lokasi stok yang dipotong.
 */
export function kanonisAsetOf(kode: KodeKondisi): "ASSET BARU" | "ASSET RETUR" | "UNREADY" {
  if (kode === "STOK-RETUR") return "ASSET RETUR";
  if (kode === "STOK-UNREADY") return "UNREADY";
  return "ASSET BARU";
}

export function groupKeyOf(row: ParsedShippingRow): string {
  return row.ticket
    ? `${row.date}|${row.branch}|${row.ticket}`
    : `${row.date}|${row.branch}|ITEM:${row.itemName.toUpperCase()}`;
}

/**
 * Gabungkan baris-baris satu permintaan (satu tiket/gerai/tanggal) menjadi baris item
 * (barang + kondisi aset + status terkirim).
 *
 * Cara file pengiriman diisi (terverifikasi pada file lapangan):
 *  - Satu blok barang = beberapa baris berurutan dengan nama barang sama.
 *  - Kolom QTY di-merge dan ditulis sekali di baris pertama blok = **total unit blok
 *    itu**, bukan qty baris tersebut (mis. QTY 23 untuk 23 baris KURSI TRAINING).
 *  - Umumnya 1 baris = 1 unit fisik (punya resi/SN sendiri), tetapi ada blok seperti
 *    "oSD Ezviz ... QTY 3" yang hanya ditulis 1 baris.
 *
 * Aturan qty: total blok = angka tertinggi antara QTY yang tertulis, jumlah
 * barcode/unit unik, dan jumlah baris; lalu dibagikan rata ke baris-baris blok
 * (tiap baris minimal 1 unit, sisanya ke baris awal). Hasil akhirnya dijumlahkan
 * per barang + kondisi aset + status terkirim.
 */
export interface RowAllocation {
  /** Unit yang dibebankan ke baris ini (hasil pembagian total blok). */
  qty: number;
  /** Bagian angka QTY file untuk baris ini (0 bila kolom QTY kosong). */
  fileShare: number;
}

/**
 * Tentukan unit per baris untuk seluruh baris satu permintaan.
 * Blok dimulai ketika nama barang berubah ATAU muncul angka QTY baru (satu angka
 * QTY hasil merge selalu memulai blok berikutnya, walau nama barangnya sama).
 */
export function allocateBlockUnits(
  rows: ParsedShippingRow[],
): Map<ParsedShippingRow, RowAllocation> {
  const blocks: ParsedShippingRow[][] = [];
  for (const r of rows) {
    const last = blocks[blocks.length - 1];
    const continues =
      Boolean(last) &&
      !r.qtyExplicit &&
      last[0].itemName.trim().toUpperCase() === r.itemName.trim().toUpperCase();
    if (continues) last.push(r);
    else blocks.push([r]);
  }

  const alloc = new Map<ParsedShippingRow, RowAllocation>();
  for (const block of blocks) {
    const explicit = round3(block.reduce((s, r) => s + (r.qtyExplicit ? r.qty : 0), 0));
    const barcodes = new Set<string>();
    for (const r of block) for (const b of splitText(r.barcode)) barcodes.add(b);
    const n = block.length;
    // Total unit blok = angka QTY yang tertulis, jumlah barcode unik, dan jumlah
    // baris (tiap baris = satu unit fisik dengan resi/SN sendiri).
    const total = round3(Math.max(explicit, barcodes.size, n));
    const base = Math.floor(total / n);
    const remainder = Math.round(total - base * n);
    block.forEach((r, i) => {
      alloc.set(r, {
        qty: round3(base + (i < remainder ? 1 : 0)),
        fileShare: explicit > 0 ? explicit / n : 0,
      });
    });
  }
  return alloc;
}

/**
 * Propagasi STATUS ASSET yang di-merge di sheet.
 *
 * Seperti kolom QTY, kolom STATUS ASSET umumnya ditulis sekali (sel merge) untuk
 * satu blok barang berurutan — baris-baris lanjutannya terbaca kosong ("").
 * Tanpa propagasi, baris lanjutan digolongkan `kondisiOf("")` = STOK-BARU
 * sehingga stok terpotong dari lokasi yang salah.
 *
 * Aturan: dalam satu blok berurutan (nama barang sama & tanpa angka QTY baru,
 * persis definisi blok di `allocateBlockUnits`), bila hanya ada SATU nilai
 * STATUS ASSET tak-kosong yang berbeda, baris kosong mewarisi nilai itu.
 * Blok yang memang berisi beberapa status eksplisit tidak diubah.
 */
export function propagateBlockStatusAset(rows: ParsedShippingRow[]): void {
  const sameItem = (a: ParsedShippingRow, b: ParsedShippingRow) =>
    a.itemName.trim().toUpperCase() === b.itemName.trim().toUpperCase();

  let start = 0;
  const flush = (end: number) => {
    const vals = new Set<string>();
    for (let i = start; i < end; i++) {
      const s = rows[i].statusAset;
      if (s !== "") vals.add(s);
    }
    if (vals.size === 1) {
      const v = [...vals][0];
      for (let i = start; i < end; i++) {
        if (rows[i].statusAset === "") rows[i].statusAset = v;
      }
    }
    start = end;
  };

  for (let i = 1; i <= rows.length; i++) {
    const cur = rows[i];
    const continues =
      cur !== undefined && !cur.qtyExplicit && sameItem(rows[i - 1], cur);
    if (!continues) flush(i);
  }
}

export function aggregateGroup(
  rows: ParsedShippingRow[],
  itemKeyOf: (row: ParsedShippingRow) => string,
): AggLine[] {
  // STATUS ASSET yang di-merge per blok: baris lanjutan yang kosong mewarisi
  // nilai bloknya supaya tidak salah digolongkan sebagai STOK-BARU.
  propagateBlockStatusAset(rows);
  const alloc = allocateBlockUnits(rows);

  // Kumpulkan per barang + kondisi aset + status terkirim.
  const byKey = new Map<string, AggLine>();
  for (const r of rows) {
    const itemKey = itemKeyOf(r);
    const kodeKondisi = kondisiOf(r.statusAset);
    const isPending = r.terkirim === "PENDING";
    const key = `${itemKey}|${kodeKondisi}|${isPending ? "PENDING" : "TERKIRIM"}`;
    let line = byKey.get(key);
    if (!line) {
      line = {
        itemKey, itemName: r.itemName, kodeKondisi, isPending,
        qty: 0, qtySource: "qty-kolom", qtyFile: 0, qtyBarcode: 0, rowCount: 0,
        blankQtyRows: 0, rows: [],
      };
      byKey.set(key, line);
    }
    line.rows.push(r);
    const a = alloc.get(r);
    if (a) {
      line.qty += a.qty;
      line.qtyFile += a.fileShare;
    }
    if (!r.qtyExplicit && !r.hasBarcode) line.blankQtyRows++;
  }

  for (const line of byKey.values()) {
    line.qty = round3(line.qty);
    line.qtyFile = round3(line.qtyFile);
    const barcodes = new Set<string>();
    for (const r of line.rows) for (const b of splitText(r.barcode)) barcodes.add(b);
    line.rowCount = line.rows.length;
    line.qtyBarcode = barcodes.size;
    if (line.qtyFile === 0) {
      line.qtySource = "jumlah-baris";
    } else if (line.qty > line.qtyFile) {
      line.qtySource = line.qtyBarcode > line.qtyFile ? "barcode" : "alokasi";
    } else {
      line.qtySource = "qty-kolom";
    }
  }
  return [...byKey.values()];
}

/** Agregasi lintas grup (dipakai untuk pratinjau sebelum import). */
export function aggregateAll(
  rows: ParsedShippingRow[],
  itemKeyOf: (row: ParsedShippingRow) => string = (r) => r.itemName.toUpperCase(),
): AggLine[] {
  return aggregateGroup(rows, itemKeyOf);
}

// ---------------------------------------------------------------- duplikat

export interface StoredItemRow {
  ticket_no: string;
  request_date: string;
  item_id: string;
  barcode: string | null;
  resi: string | null;
  qty_requested: number | string;
}

export interface DupIndex {
  counts: Map<string, number>;
}

const dupKey = (ticket: string, date: string, itemKey: string, tag: string): string =>
  `${ticket.toUpperCase()}|${date}|${itemKey}|${tag}`;

const ANON = "ANON";

/**
 * Kumpulkan "sidik jari" baris yang sudah pernah diimpor:
 * - BARCODE / RESI  -> 1 slot per nilai (baris lama bisa menyimpan banyak nilai
 *   yang dipisah baris baru karena hasil agregasi),
 * - tanpa keduanya  -> slot qty (baris anonim dibandingkan berdasarkan total qty).
 */
export function buildDupIndex(stored: StoredItemRow[]): DupIndex {
  const counts = new Map<string, number>();
  const add = (key: string, amount: number) => counts.set(key, (counts.get(key) ?? 0) + amount);
  for (const s of stored) {
    const barcodes = splitText(s.barcode);
    const resis = splitText(s.resi);
    if (barcodes.length === 0 && resis.length === 0) {
      const qty = parseNumberLike(s.qty_requested) ?? 1;
      add(dupKey(s.ticket_no, s.request_date, s.item_id, ANON), qty > 0 ? qty : 1);
      continue;
    }
    for (const b of barcodes) add(dupKey(s.ticket_no, s.request_date, s.item_id, `BC:${b}`), 1);
    for (const r of resis) add(dupKey(s.ticket_no, s.request_date, s.item_id, `RS:${r}`), 1);
  }
  return { counts };
}

export interface DupFilterResult {
  kept: ParsedShippingRow[];
  skipped: ParsedShippingRow[];
}

/** Buang baris yang identitasnya (tiket + barang + barcode/resi) sudah ada di sistem. */
export function filterDuplicateRows(
  rows: ParsedShippingRow[],
  itemKeyOf: (row: ParsedShippingRow) => string,
  index: DupIndex,
): DupFilterResult {
  const used = new Map<string, number>();
  const take = (key: string, amount: number): boolean => {
    const have = index.counts.get(key) ?? 0;
    const taken = used.get(key) ?? 0;
    if (have - taken < amount) return false;
    used.set(key, taken + amount);
    return true;
  };
  const kept: ParsedShippingRow[] = [];
  const skipped: ParsedShippingRow[] = [];
  for (const r of rows) {
    const itemKey = itemKeyOf(r);
    if (!r.ticket || !itemKey) {
      kept.push(r);
      continue;
    }
    const barcodes = splitText(r.barcode);
    const resis = splitText(r.resi);
    let duplicate = false;
    if (barcodes.length === 0 && resis.length === 0) {
      duplicate = take(dupKey(r.ticket, r.date, itemKey, ANON), r.qty > 0 ? r.qty : 1);
    } else {
      for (const b of barcodes) {
        if (take(dupKey(r.ticket, r.date, itemKey, `BC:${b}`), 1)) { duplicate = true; break; }
      }
      if (!duplicate) {
        for (const s of resis) {
          if (take(dupKey(r.ticket, r.date, itemKey, `RS:${s}`), 1)) { duplicate = true; break; }
        }
      }
    }
    (duplicate ? skipped : kept).push(r);
  }
  return { kept, skipped };
}

/** Baris dengan tiket + barang + barcode/resi sama di dalam satu file (indikasi dobel isi). */
export function findDuplicateRowsInFile(
  rows: ParsedShippingRow[],
  itemKeyOf: (row: ParsedShippingRow) => string,
): ParsedShippingRow[] {
  const seen = new Set<string>();
  const dups: ParsedShippingRow[] = [];
  for (const r of rows) {
    const itemKey = itemKeyOf(r);
    const id = r.barcode || r.resi;
    if (!r.ticket || !itemKey || !id) continue;
    const key = `${r.ticket.toUpperCase()}|${r.date}|${itemKey}|${id}`;
    if (seen.has(key)) dups.push(r);
    else seen.add(key);
  }
  return dups;
}

// ---------------------------------------------------------------- pilih sheet

export interface SheetLabel {
  /** Tanggal yang terbaca dari nama sheet (YYYY-MM-DD), null bila nama bukan tanggal. */
  date: string | null;
  /** true bila nama diawali "Copy of ". */
  isCopy: boolean;
}

/**
 * Baca nama sheet gaya "13 OKT" / "07 SEP" / "Copy of 14 OKT" / "04 JULI".
 * Tahun disimpulkan relatif terhadap tanggal acuan: bulan yang lebih besar dari
 * bulan berjalan dianggap tahun sebelumnya (file berjalan dari tengah tahun).
 */
export function parseSheetLabel(name: string, refDate: Date = new Date()): SheetLabel {
  const raw = toText(name);
  const isCopy = /^copy of\s+/i.test(raw);
  const clean = raw.replace(/^copy of\s+/i, "").replace(/\s+/g, " ").trim();
  const m = clean.match(/^(\d{1,2})\s*[-/.\s]?\s*([A-Za-z]{3,})/);
  if (!m) return { date: null, isCopy };
  const day = Number(m[1]);
  const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
  if (!mo) return { date: null, isCopy };
  let year = refDate.getFullYear();
  if (mo > refDate.getMonth() + 1) year -= 1;
  return { date: isoOf(year, mo, day), isCopy };
}

/**
 * Pilih sheet yang dipakai sistem: **sheet terbaru** (tanggal pada nama sheet).
 * - "Copy of ..." diabaikan bila ada sheet asli,
 * - saat tanggal sama, sheet dengan baris terbanyak menang,
 * - bila tidak ada nama sheet bertanggal: pakai sheet dengan baris terbanyak.
 */
/**
 * Isi tanggal untuk baris yang kolom tanggalnya kosong di file: pakai **tanggal dari nama
 * sheet** (mis. "15 OKT" → 2026-10-15), bukan tanggal hari ini.
 *
 * Alasan: baris tanpa tanggal harus selalu dapat tanggal yang sama walau sinkron dijalankan
 * berulang (tiap 15 menit) atau dijalankan besok. Kalau memakai "tanggal hari ini", baris yang
 * sama akan dianggap data baru esok hari → stok terpotong dua kali.
 */
export function applySheetDate<T extends { date: string; dateExplicit: boolean }>(
  rows: T[],
  sheetName: string,
  fallback: string = todayIso(),
): T[] {
  const sheetDate = parseSheetLabel(sheetName).date ?? fallback;
  return rows.map((r) => (r.dateExplicit ? r : { ...r, date: sheetDate }));
}

export function pickNewestSheet<T extends { name: string; rows: unknown[] }>(
  sheets: T[],
  refDate: Date = new Date(),
): T | null {
  const nonCopy = sheets.filter((s) => !parseSheetLabel(s.name, refDate).isCopy);
  const pool = nonCopy.length > 0 ? nonCopy : sheets;
  const dated = pool
    .map((s) => ({ s, label: parseSheetLabel(s.name, refDate) }))
    .filter((x) => x.label.date !== null);
  if (dated.length > 0) {
    dated.sort((a, b) => {
      if (a.label.date !== b.label.date) return a.label.date! < b.label.date! ? 1 : -1;
      return b.s.rows.length - a.s.rows.length;
    });
    return dated[0].s;
  }
  if (pool.length === 0) return null;
  return [...pool].sort((a, b) => b.rows.length - a.rows.length)[0];
}


// ================================ index.ts ==================================
// =============================================================================
// Edge Function: sync-sheets
// Menarik dokumen pengiriman dari Google Sheet ke sistem TANPA upload manual.
//
// - Selalu memakai SHEET TERBARU (nama sheet bertanggal, mis. "14 OKT").
// - Qty mengikuti aturan template dokumen pengiriman (lihat shippingUpload.ts):
//   satu angka QTY yang di-merge = total satu blok barang, dibagi ke baris-barisnya.
// - STATUS ASSET menentukan stok yang dipotong:
//   ASSET BARU → STOK-BARU · ASSET RETUR/RETURN → STOK-RETUR · UNREADY → STOK-UNREADY.
// - Idempoten: baris yang sudah pernah masuk (tiket + barang + barcode/resi)
//   dilewati, jadi dijalankan tiap 15 menit pun aman.
//
// Aksi:
//   { action: "test"    }              -> cek file & sebutkan sheet terbaru
//   { action: "preview" }              -> ringkasan yang AKAN diimpor (tanpa tulis)
//   { action: "run"     }              -> import + potong stok + catat log
// Parameter opsional: source_id, spreadsheet_id, sheet_mode, sheet_name,
//                     deduct_stock, allow_negative, auto_create_items
// =============================================================================
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? SERVICE_KEY;
const LOKASI: KodeKondisi[] = ["STOK-BARU", "STOK-RETUR", "STOK-UNREADY"];

interface SourceConfig {
  id?: string;
  name?: string;
  spreadsheet_id: string;
  sheet_mode: "newest" | "named";
  sheet_name?: string | null;
  deduct_stock: boolean;
  allow_negative: boolean;
  auto_create_items: boolean;
}

interface FailLine { ticket: string; detail: string }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function pesanError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]")
    .replace(/Stok tidak mencukupi \(item \[id\][^)]*\)/i, "Stok tidak mencukupi")
    .slice(0, 500);
}

/** Kumpulkan sidik jari baris yang sudah pernah diimpor (untuk idempotensi). */
async function loadStoredFingerprints(
  db: SupabaseClient,
  rows: ParsedShippingRow[],
): Promise<DupIndex> {
  const tickets = [...new Set(rows.map((r) => r.ticket).filter(Boolean))];
  const dates = [...new Set(rows.map((r) => r.date))];
  if (tickets.length === 0 || dates.length === 0) return buildDupIndex([]);
  const stored: StoredItemRow[] = [];
  const { data: reqs, error } = await db
    .from("requests")
    .select("id, ticket_no, request_date")
    .in("ticket_no", tickets.slice(0, 200))
    .in("request_date", dates.slice(0, 60))
    .limit(5000);
  if (error) throw new Error(`Gagal membaca permintaan lama: ${error.message}`);
  const reqById = new Map(
    ((reqs ?? []) as { id: string; ticket_no: string; request_date: string }[]).map((r) => [r.id, r]),
  );
  if (reqById.size === 0) return buildDupIndex([]);
  for (let i = 0; i < reqById.size; i += 100) {
    const ids = [...reqById.keys()].slice(i, i + 100);
    const { data: items, error: itErr } = await db
      .from("request_items")
      .select("request_id, item_id, barcode, resi, qty_requested")
      .in("request_id", ids)
      .limit(5000);
    if (itErr) throw new Error(`Gagal membaca item lama: ${itErr.message}`);
    for (const it of (items ?? []) as {
      request_id: string; item_id: string; barcode: string | null; resi: string | null; qty_requested: number | string;
    }[]) {
      const req = reqById.get(it.request_id);
      if (!req) continue;
      stored.push({
        ticket_no: req.ticket_no,
        request_date: req.request_date,
        item_id: it.item_id,
        barcode: it.barcode,
        resi: it.resi,
        qty_requested: it.qty_requested,
      });
    }
  }
  return buildDupIndex(stored);
}

interface ImportResult {
  sheet: string;
  sheetDate: string | null;
  rowsTotal: number;
  rowsNew: number;
  rowsSkippedDup: number;
  rowsDupInFile: number;
  rowsTanpaMaster: number;
  requests: number;
  items: number;
  qty: number;
  failures: FailLine[];
  preview: { item: string; kondisi: string; qty: number; rows: number; aset: string }[];
  unmatched: string[];
}

/**
 * Proses inti: unduh → pilih sheet terbaru → cocokkan barang → buang duplikat →
 * (bila bukan dryRun) buat permintaan + potong stok.
 */
async function syncSource(
  db: SupabaseClient,
  cfg: SourceConfig,
  opts: { dryRun: boolean; actorId: string | null; triggeredBy: "cron" | "manual" },
): Promise<ImportResult> {
  const wb = await downloadWorkbook(cfg.spreadsheet_id);
  const parsed = parseWorkbook(wb);
  if (parsed.sheets.length === 0) {
    throw new Error("Tidak ada sheet berisi tabel pengiriman (kolom NAMA BARANG) di file itu.");
  }

  let dipakai = pickNewestSheet(parsed.sheets) ?? parsed.sheets[0];
  if (cfg.sheet_mode === "named" && cfg.sheet_name) {
    const nama = cfg.sheet_name.trim().toUpperCase();
    const dicari = parsed.sheets.find((s) => s.name.trim().toUpperCase() === nama);
    if (!dicari) {
      throw new Error(
        `Sheet "${cfg.sheet_name}" tidak ditemukan. Sheet yang ada: ${parsed.sheets.map((s) => s.name).join(", ")}.`,
      );
    }
    dipakai = dicari;
  }
  // Baris tanpa tanggal memakai tanggal sheet (bukan tanggal hari ini) supaya sinkron
  // berulang di hari berbeda tidak menganggapnya data baru (stok terpotong dua kali).
  const semuaBaris = applySheetDate(dipakai.rows, dipakai.name);

  // Cocokkan nama barang dengan master.
  const { data: items, error: itemsErr } = await db
    .from("inventory_items")
    .select("id, name")
    .eq("is_active", true)
    .limit(5000);
  if (itemsErr) throw new Error(`Gagal membaca master barang: ${itemsErr.message}`);
  const byName = new Map<string, string>();
  for (const it of (items ?? []) as { id: string; name: string }[]) {
    byName.set(it.name.trim().toUpperCase(), it.id);
  }

  const unmatched = [
    ...new Set(semuaBaris.filter((r) => !byName.has(r.itemName.toUpperCase())).map((r) => r.itemName)),
  ];
  if (cfg.auto_create_items && unmatched.length > 0 && !opts.dryRun) {
    const { data: units } = await db.from("units").select("id, code").limit(50);
    const pcs =
      ((units ?? []) as { id: string; code: string }[]).find((u) => u.code.toUpperCase() === "PCS") ??
      (units?.[0] as { id: string } | undefined);
    if (!pcs) throw new Error("Tabel satuan kosong — hubungi Super Admin.");
    const stamp = Date.now().toString(36).toUpperCase();
    const { data: created, error } = await db
      .from("inventory_items")
      .insert(
        unmatched.map((n, i) => ({
          sku: `SYNC-${stamp}-${i}`,
          name: n,
          unit_id: pcs.id,
          is_active: true,
        })),
      )
      .select("id, name");
    if (error) throw new Error(`Gagal membuat barang baru: ${error.message}`);
    for (const c of (created ?? []) as { id: string; name: string }[]) {
      byName.set(c.name.trim().toUpperCase(), c.id);
    }
  } else if (unmatched.length > 0 && !cfg.auto_create_items && !opts.dryRun) {
    // Saat pratinjau kita tetap lanjut supaya daftar barang baru bisa dilihat.
    throw new Error(
      `${unmatched.length} nama barang belum ada di master (contoh: ${unmatched.slice(0, 5).join(", ")}). ` +
        'Tambahkan di Master Barang atau aktifkan "Buat barang baru otomatis" lalu jalankan lagi.',
    );
  }

  // Baris yang barangnya belum ada di master tidak bisa diproses (kecuali auto-create).
  const rows = semuaBaris.filter((r) => byName.has(r.itemName.toUpperCase()));
  const rowsTanpaMaster = semuaBaris.length - rows.length;

  // Buang baris yang sudah pernah masuk (idempoten).
  const keyOf = (r: ParsedShippingRow): string => byName.get(r.itemName.toUpperCase()) ?? "";
  const index = await loadStoredFingerprints(db, rows);
  const { kept, skipped } = filterDuplicateRows(rows, keyOf, index);
  const dupInFile = findDuplicateRowsInFile(kept, keyOf);

  // Lokasi stok per kondisi.
  const locByKondisi = new Map<KodeKondisi, string>();
  if (cfg.deduct_stock) {
    const { data: locs } = await db.from("locations").select("id, code").in("code", LOKASI);
    for (const l of ((locs ?? []) as { id: string; code: string }[])) {
      locByKondisi.set(l.code as KodeKondisi, l.id);
    }
    if (!locByKondisi.has("STOK-BARU")) throw new Error("Lokasi STOK-BARU belum ada di database.");
  }

  // Kelompokkan per permintaan (tanggal + gerai + tiket).
  const groups = new Map<string, ParsedShippingRow[]>();
  for (const r of kept) {
    const k = groupKeyOf(r);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  const result: ImportResult = {
    sheet: dipakai.name,
    sheetDate: parseSheetLabel(dipakai.name).date,
    rowsTotal: semuaBaris.length,
    rowsNew: kept.length,
    rowsSkippedDup: skipped.length,
    rowsDupInFile: dupInFile.length,
    rowsTanpaMaster,
    requests: 0,
    items: 0,
    qty: 0,
    failures: [],
    preview: [],
    unmatched,
  };

  let n = 0;
  for (const rs of groups.values()) {
    n++;
    const first = rs[0];
    const ticket = first.ticket || null;
    const lines = aggregateGroup(rs, keyOf);
    for (const l of lines) {
      result.preview.push({
        item: l.itemName,
        kondisi: l.kodeKondisi,
        qty: l.qty,
        rows: l.rowCount,
        aset: l.rows[0]?.statusAset || "",
      });
    }
    result.qty += lines.reduce((s, l) => s + l.qty, 0);
    result.items += lines.length;
    if (opts.dryRun) continue;

    let reqId: string | null = null;
    try {
      const hasPending = lines.some((l) => l.isPending);
      const { data: req, error: reqErr } = await db
        .from("requests")
        .insert({
          ticket_no: ticket ?? `UPL-${first.date}-${n}`,
          request_date: first.date,
          branch_name: first.branch,
          branch_code: first.branchCode || null,
          status: "disetujui",
          notes: `Sinkron Google Sheet otomatis (${dipakai.name}).`,
          requested_by: opts.actorId,
          reviewed_by: opts.actorId,
          reviewed_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (reqErr) throw new Error(reqErr.message);
      reqId = req.id as string;

      const planned = lines.map((line: AggLine) => ({
        line,
        id: crypto.randomUUID(),
      }));
      const payload = planned.map(({ line, id }) => ({
        id,
        request_id: reqId,
        item_id: line.itemKey,
        qty_requested: line.qty,
        qty_approved: line.qty,
        qty_shipped: 0,
        barcode: [...new Set(line.rows.map((x) => x.barcode).filter(Boolean))].join("\n") || null,
        item_type: line.rows[0]?.typeBarang || null,
        status_aset: kanonisAsetOf(line.kodeKondisi),
        resi: [...new Set(line.rows.map((x) => x.resi).filter(Boolean))].join("\n") || null,
        item_status: line.isPending ? "pending_sebagian" : "disetujui",
        notes: [...new Set(
          line.rows.map((x) =>
            [x.ket && `Ket: ${x.ket}`, x.statusRequest && `Status request: ${x.statusRequest}`]
              .filter(Boolean)
              .join(" | "),
          ),
        )].filter(Boolean).join("\n") || null,
      }));
      const { error: insErr } = await db.from("request_items").insert(payload);
      if (insErr) throw new Error(insErr.message);
      result.requests++;

      if (cfg.deduct_stock) {
        const perKondisi = new Map<KodeKondisi, { request_item_id: string; qty: number; resi: string }[]>();
        for (const { line, id } of planned) {
          if (line.isPending) continue;
          const list = perKondisi.get(line.kodeKondisi) ?? [];
          list.push({
            request_item_id: id,
            qty: line.qty,
            resi: line.rows.map((x) => x.resi).find(Boolean) ?? "",
          });
          perKondisi.set(line.kodeKondisi, list);
        }
        for (const [kode, plines] of perKondisi) {
          const locId = locByKondisi.get(kode);
          if (!locId) throw new Error(`Lokasi ${kode} belum ada di database.`);
          const { error: shipErr } = await db.rpc("sync_ship_request_items", {
            p_request_id: reqId,
            p_location_id: locId,
            p_lines: plines,
            p_notes: `Sinkron Google Sheet ${ticket ?? ""} (${kode}) — sheet ${dipakai.name}`.trim(),
            p_allow_negative: cfg.allow_negative,
          });
          if (shipErr) throw new Error(`Gagal kirim ${ticket ?? "tanpa tiket"} [${kode}]: ${shipErr.message}`);
        }
        if (hasPending) {
          await db.from("requests").update({ status: "disetujui_sebagian" }).eq("id", reqId);
        }
      } else {
        for (const { line, id } of planned) {
          await db
            .from("request_items")
            .update({
              qty_shipped: line.isPending ? 0 : line.qty,
              item_status: line.isPending ? "pending_sebagian" : "terkirim",
            })
            .eq("id", id);
        }
        await db
          .from("requests")
          .update({ status: hasPending ? "disetujui_sebagian" : "selesai" })
          .eq("id", reqId);
      }
    } catch (e) {
      if (reqId) await db.from("requests").delete().eq("id", reqId);
      result.failures.push({ ticket: ticket ?? `grup ${n}`, detail: pesanError(e) });
    }
  }

  if (!opts.dryRun && cfg.id) {
    const status = result.failures.length === 0 ? "sukses" : result.requests > 0 ? "sebagian" : "gagal";
    await db
      .from("sheet_sync_sources")
      .update({
        last_sheet: dipakai.name,
        last_run_at: new Date().toISOString(),
        last_status: status,
        last_message:
          `Sheet ${dipakai.name}: ${result.requests} permintaan, ${result.items} baris, ` +
          `${result.qty} unit` + (result.failures.length ? `, ${result.failures.length} gagal` : ""),
        last_requests: result.requests,
        last_items: result.items,
        last_qty: result.qty,
      })
      .eq("id", cfg.id);
  }
  return result;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = (body.action as string) ?? "run";
    const dryRun = action === "preview" || action === "test";
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const isService = token === SERVICE_KEY;

    const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // Sumber konfigurasi: dari tabel (source_id) atau parameter langsung.
    let cfg: SourceConfig | null = null;
    let actorId: string | null = null;

    if (typeof body.source_id === "string" && body.source_id) {
      const { data, error } = await db
        .from("sheet_sync_sources")
        .select("*")
        .eq("id", body.source_id)
        .maybeSingle();
      if (error) throw new Error(`Gagal membaca konfigurasi: ${error.message}`);
      if (!data) return json({ error: "Sumber sinkronisasi tidak ditemukan." }, 404);
      cfg = {
        id: data.id,
        name: data.name,
        spreadsheet_id: data.spreadsheet_id,
        sheet_mode: data.sheet_mode,
        sheet_name: data.sheet_name,
        deduct_stock: data.deduct_stock,
        allow_negative: data.allow_negative,
        auto_create_items: data.auto_create_items,
      };
    } else if (typeof body.spreadsheet_id === "string" && body.spreadsheet_id) {
      const id = extractSpreadsheetId(body.spreadsheet_id);
      if (!id) return json({ error: "Link/ID Google Sheet tidak valid." }, 400);
      cfg = {
        spreadsheet_id: id,
        sheet_mode: (body.sheet_mode as "newest" | "named") ?? "newest",
        sheet_name: (body.sheet_name as string) ?? null,
        deduct_stock: body.deduct_stock !== false,
        allow_negative: body.allow_negative !== false,
        auto_create_items: body.auto_create_items === true,
      };
    }

    if (!cfg) {
      // Tanpa parameter: jalankan semua sumber aktif (dipakai cron).
      if (!isService) return json({ error: "Hanya service role (cron) yang bisa menjalankan semua sumber." }, 403);
      const { data: sources, error } = await db
        .from("sheet_sync_sources")
        .select("*")
        .eq("is_active", true);
      if (error) throw new Error(error.message);
      const hasil: unknown[] = [];
      for (const s of sources ?? []) {
        const runId = await startRun(db, s.id, "cron");
        try {
          const res = await syncSource(
            db,
            {
              id: s.id,
              name: s.name,
              spreadsheet_id: s.spreadsheet_id,
              sheet_mode: s.sheet_mode,
              sheet_name: s.sheet_name,
              deduct_stock: s.deduct_stock,
              allow_negative: s.allow_negative,
              auto_create_items: s.auto_create_items,
            },
            { dryRun: false, actorId: null, triggeredBy: "cron" },
          );
          await finishRun(db, runId, res, "cron");
          hasil.push({ source: s.name, ...res });
        } catch (e) {
          const msg = pesanError(e);
          await db
            .from("sheet_sync_runs")
            .update({ status: "gagal", finished_at: new Date().toISOString(), message: msg })
            .eq("id", runId);
          await db
            .from("sheet_sync_sources")
            .update({ last_run_at: new Date().toISOString(), last_status: "gagal", last_message: msg })
            .eq("id", s.id);
          hasil.push({ source: s.name, error: msg });
        }
      }
      return json({ ok: true, sources: (sources ?? []).length, hasil });
    }

    // Aksi oleh pengguna: wajib punya settings.manage / super admin.
    if (!isService) {
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
        auth: { persistSession: false },
      });
      const { data: userData } = await userClient.auth.getUser();
      actorId = userData?.user?.id ?? null;
      const { data: boleh } = await userClient.rpc("has_permission", { p_code: "settings.manage" });
      const { data: superAdmin } = await userClient.rpc("is_super_admin");
      if (!boleh && !superAdmin) {
        return json({ error: "Hanya Super Admin (settings.manage) yang bisa menjalankan sinkronisasi." }, 403);
      }
    }

    if (action === "test") {
      const wb = await downloadWorkbook(cfg.spreadsheet_id);
      const parsed = parseWorkbook(wb);
      const terbaru = pickNewestSheet(parsed.sheets);
      return json({
        ok: true,
        fileId: cfg.spreadsheet_id,
        sheetsDenganData: parsed.sheets.length,
        totalSheets: parsed.sheets.length + parsed.skipped.length,
        sheetTerbaru: terbaru?.name ?? null,
        sheetTerbaruTanggal: terbaru ? parseSheetLabel(terbaru.name).date : null,
        barisSheetTerbaru: terbaru?.rows.length ?? 0,
        contohSheet: parsed.sheets.slice(-5).map((s) => ({ name: s.name, rows: s.rows.length })),
      });
    }

    const runId = dryRun ? null : await startRun(db, cfg.id ?? null, isService ? "cron" : "manual");
    try {
      const res = await syncSource(db, cfg, {
        dryRun,
        actorId,
        triggeredBy: isService ? "cron" : "manual",
      });
      if (runId) await finishRun(db, runId, res, "manual");
      return json({ ok: res.failures.length === 0, dryRun, ...res });
    } catch (e) {
      const msg = pesanError(e);
      if (runId) {
        await db
          .from("sheet_sync_runs")
          .update({ status: "gagal", finished_at: new Date().toISOString(), message: msg })
          .eq("id", runId);
      }
      if (cfg.id) {
        await db
          .from("sheet_sync_sources")
          .update({ last_run_at: new Date().toISOString(), last_status: "gagal", last_message: msg })
          .eq("id", cfg.id);
      }
      return json({ error: msg }, 400);
    }
  } catch (e) {
    return json({ error: pesanError(e) }, 400);
  }
});

async function startRun(
  db: SupabaseClient,
  sourceId: string | null,
  _triggeredBy: "cron" | "manual",
): Promise<string | null> {
  if (!sourceId) return null;
  const { data } = await db
    .from("sheet_sync_runs")
    .insert({ source_id: sourceId, status: "jalan", triggered_by: _triggeredBy })
    .select("id")
    .single();
  return (data?.id as string) ?? null;
}

async function finishRun(
  db: SupabaseClient,
  runId: string | null,
  res: ImportResult,
  triggeredBy: "cron" | "manual",
): Promise<void> {
  if (!runId) return;
  const status = res.failures.length === 0 ? "sukses" : res.requests > 0 ? "sebagian" : "gagal";
  await db
    .from("sheet_sync_runs")
    .update({
      status,
      finished_at: new Date().toISOString(),
      sheet_name: res.sheet,
      requests_created: res.requests,
      items_created: res.items,
      qty_imported: res.qty,
      rows_skipped_dup: res.rowsSkippedDup,
      message:
        `${res.rowsNew}/${res.rowsTotal} baris baru` +
        (res.rowsSkippedDup ? `, ${res.rowsSkippedDup} duplikat dilewati` : "") +
        (res.failures.length ? `, ${res.failures.length} gagal` : ""),
      detail: { failures: res.failures.slice(0, 20), preview: res.preview.slice(0, 50), triggeredBy },
    })
    .eq("id", runId);
}

// Dipakai test lokal (npm run test) agar logika bisa diuji tanpa Deno.
export { syncSource };
```
<!-- COPAS SELESAI (BLOK B) -->

---
---

# 🟨 BLOK C — untuk LANGKAH 4 (Supabase → SQL Editor)

**Cara:** Supabase → SQL Editor → New query → copas di bawah ini → **ganti 2 tulisan dulu** → Run.

Ganti ini dulu sebelum Run:

| Tulisan | Diganti dengan | Lihat di |
|---|---|---|
| `<PROJECT-REF>` | Reference ID project | Project Settings → General → Reference ID |
| `<SERVICE-ROLE-KEY>` | kunci service_role | Project Settings → API Keys → service_role (tulisan *secret*) |

> ⚠️ Kunci itu rahasia — jangan kirim ke siapa pun. Cukup paste di kolomnya, jangan simpan di chat/WA.

<!-- COPAS MULAI (BLOK C) -->
```sql
-- =============================================================================
-- JADWAL SINKRON OTOMATIS TIAP 15 MENIT (pg_cron) — 1x copas
-- =============================================================================
-- SEBELUM MENJALANKAN, GANTI DUA TEMPAT BERIKUT:
--   <PROJECT-REF>        → lihat: Supabase Dashboard → Project Settings → General → "Reference ID"
--                          (juga terlihat di URL dashboard: supabase.com/dashboard/project/xxxxxxxx)
--   <SERVICE-ROLE-KEY>   → lihat: Project Settings → API Keys → bagian "service_role" → klik Reveal/Copy
--
--   CATATAN: service_role key itu RAHASIA (setara password admin). Jangan dibagikan
--   ke siapa pun dan jangan ditaruh di chat/WhatsApp. SQL ini hanya disimpan di
--   database kamu sendiri.
--
-- Kalau nama fungsi Edge kamu BUKAN "sync-sheets", ganti juga bagian /sync-sheets di URL.
-- =============================================================================

-- 1) Aktifkan penjadwal + pemanggil HTTP
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2) Jadwalkan tiap 15 menit (ganti 2 placeholder di bawah!)
SELECT cron.schedule(
  'sync-google-sheet-pengiriman',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://<PROJECT-REF>.supabase.co/functions/v1/sync-sheets',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer <SERVICE-ROLE-KEY>'
               ),
    body    := jsonb_build_object('action', 'run')
  ) AS request_id;
  $$
);

-- 3) Cek jadwal aktif
SELECT jobid, jobname, schedule, active FROM cron.job;

-- 4) (Opsional) lihat hasil eksekusi terakhir
SELECT status, return_message, start_time
FROM cron.job_run_details
ORDER BY start_time DESC
LIMIT 10;

-- 5) Cara MATIKAN jadwal (kalau ingin berhenti):
-- SELECT cron.unschedule('sync-google-sheet-pengiriman');
```
<!-- COPAS SELESAI (BLOK C) -->

---
---

## ✅ Checklist setelah selesai

- [ ] **Langkah 1** — BLOK A di Run → muncul `Success. No rows returned`
- [ ] **Langkah 2** — BLOK B di Deploy → status *Deployed* di `sync-sheets`
- [ ] **Langkah 3** — Di aplikasi, panel **Sinkron Google Sheet**: Tes koneksi **hijau** → Simpan → Pratinjau (barang contoh **KURSI TRAINING = 23**) → Sinkron sekarang
- [ ] **Langkah 4** — BLOK C (sudah diganti 2 tulisan) di Run → muncul `Success` + `cron.job` → `active = true`
- [ ] **Cek** — query di `CEK-SINKRON.md`: konfigurasi ≥ 1, status `sukses`, kode HTTP `200`
- [ ] **Langkah 5** — Merge PR #4 di GitHub

Kalau ada tulisan merah / error di salah satu langkah → screenshot lalu kirim. Tulis juga langkah berapa.
