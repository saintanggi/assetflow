# Ringkasan Audit & Remediasi Menyeluruh AssetFlow (Fase 1–4)

**Tanggal:** 26 November 2026  
**Prinsip Utama:** 100% Non-Breaking, Idempoten, Zero-Downtime — tidak menghapus atau mengubah struktur data produksi yang sedang berjalan, tidak mengubah file migrasi historis.

---

## Ringkasan 4 Fase

### Fase 1 — Perbaikan Bug P0 & Celah Keamanan Kritis
- **Purchase Order (`receive_purchase_order` & `create_purchase_order`)**: Tambah `GRANT EXECUTE TO authenticated`, validasi `inventory.receive`, blokir `draft` PO, posting `status = 'posted'` + `posted_at`, idempotency key anti-dobel, validasi `allow_decimal`, nomor urut PO atomik server-side, dan perbaikan aman transaksi `PO/%` historis berstatus `draft` tanpa mengubah saldo.
- **Penegakan MFA (AAL1 → AAL2)**: `AuthContext`, `LoginPage`, dan route guards (`RequireAuth`, `RequirePermission`, `RequireSuperAdmin`) kini wajib memverifikasi TOTP sebelum mengizinkan akses rute internal.
- **Penyambungan Fitur Terputus**:
  - `itemCorrection.ts` (`admin_change_request_item`) & `deleteItem.ts` (`admin_delete_request_item`) disambungkan ke `RequestDetailPage.tsx` dan `PendingPartialPage.tsx`.
  - `SerialLabelPanel.tsx` (`allocate_qr_labels`) disambungkan ke `LabelPrintPage.tsx` sebagai tab **"Label QR Serial Unik"**.
- **Anti-Korupsi Stok Partial (`cancel_pending_request_item`)**: Menutup sisa belum terkirim tanpa menghapus baris `qty_shipped > 0` (mencegah purge stok yang sudah terkirim) dan menghitung ulang `requests.status`.
- **Bebas Tabrakan Idempotency (`admin_move_stock_between_items` & `admin_change_request_item`)**: Kunci revisi kini unik per `request_item_id`.
- **Perlindungan Void (`void_inventory_transaction`)**: Tambah `FOR UPDATE` row locking terurut, blokir void transaksi sistem (`REQ-KIRIM/%`, `HAPUS-ITEM/%`, `PO/%`), dan simpan snapshot lengkap ke `audit_logs`.
- **Maker-Checker DB Triggers**: Mencegah `helper`/non-reviewer mengubah `qty_approved`, `qty_shipped`, atau status approval langsung lewat PostgREST.

### Fase 2 — Stabilisasi, Skala, Edge Functions, Audit Trail & CI/CD
- **Timezone WIB (`today_wib()` & `todayLocalDate()`)** di seluruh RPC & ekspor frontend.
- **RPC Server-Side Anti-Truncate**: `get_nav_queue_counts()`, `get_dead_stock(p_days)`, `split_request_item()`, dan advisory lock `try_lock_sheet_sync()` / `unlock_sheet_sync()`.
- **Signed URL Surat Jalan (`ProofImage.tsx`)**: Mendukung bucket privat secara otomatis dengan fallback mulus ke URL lama.
- **Hardening Edge Functions**:
  - `manage-users`: proteksi `super_admin` & diri sendiri, cek error `profiles.upsert`, rekam `audit_logs`, dukung `ALLOWED_ORIGIN`.
  - `sync-sheets`: chunked fingerprint lookup >200 tiket & tiket kosong, paginasi master barang, advisory lock, pembatasan `spreadsheet_id` kustom, SheetJS `0.20.3`.
- **Perluasan Audit Trail**: Trigger `log_audit()` aktif pada 11 tabel operasional tambahan.
- **CI/CD**: `.github/workflows/ci.yml` (Node 22: `tsc`, `oxlint`, `vitest`, `vite build`).

### Fase 3 — Upgrade Keamanan Menyeluruh & Hardening DB
- **0 Production Vulnerabilities (`npm audit --omit=dev`)**: Upgrade `xlsx@0.20.3`, `zod@4.6.7`, `react-router-dom@7.18.7`.
- **HTTP Security Headers & CSP (`vercel.json`)**: HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` (kamera diizinkan untuk `self`), dan `Content-Security-Policy`.
- **Proteksi CSV Formula Injection (`src/lib/csv.ts`)** + batas upload Excel 15 MB + kebijakan password baru minimal 8 karakter (akun lama tetap login normal).
- **Paginasi Anti-Truncate (`src/lib/supabasePagination.ts`)** pada `sku.ts`, `StockAlertsPage`, `TransactionLogPage`, `TransactionHistoryPage`, `StockOpnamePage`.
- **DB Hardening (`20261126000002_phase3_security_hardening.sql`)**: Tutup celah akun nonaktif di `is_super_admin()` & `is_staff()`, `audit_logs` permanen (*append-only*), auto-pin `search_path` pada semua fungsi `SECURITY DEFINER`, dan 7 indeks performa.

### Fase 4 — Standar Gudang Profesional & Modularisasi
- **Sentralisasi Helper Lokasi (`src/lib/stockLocations.ts`)**: Sumber kebenaran tunggal pemetaan kondisi stok (`ASSET BARU`/`ASSET RETUR`/`UNREADY` ↔ `*-BARU`/`*-RETUR`/`*-UNREADY` & `STOK-*`) tanpa fallback acak `locations[0]`.
- **Live Stock Indicator (`TransactionForm.tsx`)**: Menampilkan stok tersedia secara langsung saat memilih barang pada transaksi Keluar / Transfer dan mencegah upload foto surat jalan bila stok kurang.
- **Scan Barcode (+1) Langsung**: Tersedia di **Terima PO (`PurchaseOrderDetailPage.tsx`)** dan **Stock Opname (`StockOpnamePage.tsx`)** baik lewat scanner genggam (Enter) maupun kamera HP (`BarcodeScanner`).
- **Modularisasi `RequestDetailPage.tsx`**: Ekstraksi `RequestPrintSheet.tsx`, `RequestAddItemDialog.tsx`, dan `RequestItemEditDialog.tsx`.

### Fase 5 — Live Infrastructure Lockdown (Sudah Aktif di Produksi `vzkvmbydnwcjdthdqcdi`)
- **Migrasi `20261125103347_phase5_live_infra_lockdown`**: Mengaktifkan RLS pada `public.hist_staging` (`tables_without_rls = 0` di seluruh 41 tabel) dan membatasi 3 bucket Storage (`asset-photos`, `item-photos`, `surat-jalan`) ke maks. **10 MB** + MIME aman (`image/jpeg`, `image/png`, `image/webp`, plus `application/pdf` untuk `surat-jalan`).
- **Supabase Auth**: `disable_signup = true` (mencegah pendaftaran publik; pembuatan akun via Super Admin `manage-users` tetap berjalan normal).
- **Supabase Secret**: `ALLOWED_ORIGIN = https://assetflow-opal.vercel.app`.
- **Edge Function `manage-users`**: Deployed & ACTIVE (`v6`).

---

## Catatan Migrasi Historis (Jangan Diubah)
- Dua file migrasi lama `20261016000034_fix_shipping_locations.sql` dan `20261016000034_item_deletion_and_correction.sql` berbagi nomor versi historis. **Jangan di-rename** jika sudah tercatat di `supabase_migrations.schema_migrations` produksi agar tidak memicu konflik riwayat migrasi CLI.

## Urutan Deploy Produksi (Zero-Downtime)
1. Jalankan `docs/sql/audit_p0_security_and_data_fixes.sql` di Supabase SQL Editor (atau `supabase db push`).
2. Jalankan `docs/sql/phase3_security_hardening.sql` di Supabase SQL Editor.
3. Deploy Edge Functions:
   ```bash
   supabase functions deploy manage-users
   supabase functions deploy sync-sheets
   ```
   *(Opsional)* Set secret `ALLOWED_ORIGIN=https://assetflow-opal.vercel.app`.
4. Commit & push ke GitHub (otomatis menjalankan CI & deploy Vercel).
5. *(Opsional, setelah semua pengguna memakai build frontend terbaru)* Privatkan bucket surat jalan:
   ```sql
   UPDATE storage.buckets SET public = false WHERE id = 'surat-jalan';
   ```
