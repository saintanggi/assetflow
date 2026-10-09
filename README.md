# AssetFlow — Sistem Informasi Manajemen Aset & Gudang

Aplikasi web enterprise untuk manajemen **aset tetap** (laptop, printer, kendaraan, …)
dan **persediaan gudang** (ATK, suku cadang, bahan habis pakai, …) dengan transaksi
stok atomik, QR code / barcode, audit log, laporan, dan tiga mode akses
(Super Admin, Admin, Pengunjung Publik).

**Stack:** React 18 + TypeScript + Vite · Tailwind CSS 3 + komponen gaya shadcn/ui ·
Supabase (PostgreSQL + Auth + Storage) · React Router · React Hook Form + Zod ·
TanStack Table · Recharts · Lucide · qrcode.react · jsbarcode · html5-qrcode · Vitest.

---

## 1. Persiapan

### Prasyarat

- Node.js 20+
- Akun [Supabase](https://supabase.com) (2 proyek disarankan: development & production)
- Akun [Vercel](https://vercel.com) untuk hosting frontend

### Instalasi lokal

```bash
git clone <repo-anda>
cd assetflow
cp .env.example .env
# isi VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_APP_URL di .env
npm install
npm run dev
```

### Environment variables

| Variabel | Wajib | Keterangan |
|---|---|---|
| `VITE_SUPABASE_URL` | Ya | URL proyek Supabase, mis. `https://xyzcompany.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Ya | **Anon public key** saja. Jangan pernah taruh service-role key di frontend |
| `VITE_APP_URL` | Ya | URL publik aplikasi, mis. `https://assetflow.vercel.app` — dipakai untuk QR code aset publik |
| `VITE_APP_NAME` | Tidak | Nama aplikasi (default: AssetFlow) |

> Tidak ada kredensial default dan tidak ada endpoint publik untuk menjadikan
> pengguna sebagai Super Admin.

---

## 2. Database (Supabase)

Skema lengkap + RLS + fungsi RPC ada di `supabase/migrations/` (dikerjakan bertahap
sesuai `docs/IMPLEMENTATION_PLAN.md` — kontrak tabel/kolom/RPC yang wajib dipatuhi).

Urutan apply (di SQL Editor Supabase atau via Supabase CLI):

1. `supabase/migrations/*_schema.sql` — tabel inti
2. `supabase/migrations/*_rls.sql` — Row Level Security
3. `supabase/migrations/*_functions.sql` — helper `is_super_admin()`, `has_permission()`,
   RPC `post_inventory_transaction`, `reverse_inventory_transaction`,
   `finalize_stock_count`, `get_public_asset`, `search_public_assets`
4. `supabase/migrations/*_seed.sql` — roles, permissions, satuan dasar

### Bootstrap Super Admin pertama

1. Buat user pertama lewat **Supabase Dashboard → Authentication → Add user**
   (atau biarkan user mendaftar bila sign-up diaktifkan).
2. Jalankan `supabase/bootstrap/superadmin.sql` di SQL Editor — ganti email di
   dalamnya dengan email user tersebut. Script hanya mempromosikan bila **belum ada**
   Super Admin sama sekali.
3. Login sebagai user itu → buka **Panel Super Admin** (`/admin`).

### Storage

Buat bucket **`asset-photos`** (public read). Policy: `INSERT` untuk role
`authenticated` dengan batas 5 MB dan tipe `image/*`.

---

## 3. Menjalankan & menguji

```bash
npm run dev      # development server
npm run build    # type-check (tsc) + build produksi → dist/
npm run preview  # pratinjau hasil build
npm run test     # Vitest (sekali jalan)
```

Tes yang tersedia: `src/lib/format.test.ts`, `src/routes/guards.test.tsx`,
`src/schemas/asset.test.ts`. Tes database (RLS & RPC) ada di `supabase/tests/`.

---

## 4. Struktur source code

```
src/
  components/        # UI generik: ui/* (button, input, dialog, …), DataTable, StatCard,
                     # PageHeader, ConfirmDialog, EmptyState, CrudPage
  layouts/           # AppLayout (sidebar + header per role), PublicLayout
  pages/             # 30 halaman (Landing … NotFound)
  features/
    transactions/    # TransactionForm (dipakai Barang Masuk/Keluar/Transfer)
    barcodes/        # QrLabel, BarcodeLabel
  lib/               # supabase client, format id-ID, csv, permissions, utils
  context/           # AuthContext (session, profile, permissions)
  types/             # database.ts — HARUS cocok dengan IMPLEMENTATION_PLAN.md
  schemas/           # skema Zod: asset, inventory, transaction
  routes/            # index.tsx (definisi route), guards.tsx
supabase/
  migrations/        # migrasi SQL berversi
  bootstrap/         # superadmin.sql
  tests/             # tes SQL RLS/RPC
docs/                # IMPLEMENTATION_PLAN.md (kontrak)
```

---

## 5. Mode akses

| Kemampuan | Super Admin | Admin | Publik |
|---|---|---|---|
| Semua modul & nilai aset | ✅ | — | — |
| Kelola pengguna & peran | ✅ | — | — |
| Audit log, pengaturan | ✅ | — | — |
| Aset & persediaan (sesuai permission) | ✅ | ✅ | — |
| Transaksi stok via RPC | ✅ | ✅ (sesuai izin) | — |
| Cetak label | ✅ | ✅ (`labels.print`) | — |
| Katalog publik (whitelist) | ✅ | ✅ | ✅ |
| Data privat (harga, serial, stok) | ✅ | ✅ | ❌ |

Permission `assets.publish` hanya dapat diberikan oleh Super Admin — ditegakkan di
database (bukan cuma di UI).

---

## 6. Deployment ke Vercel

1. Push repo ke GitHub.
2. Di Vercel: **Add New Project → Import** repo → framework terdeteksi **Vite**.
   - Build Command: `npm run build`
   - Output Directory: `dist`
3. Isi Environment Variables (Production): `VITE_SUPABASE_URL`,
   `VITE_SUPABASE_ANON_KEY`, `VITE_APP_URL` (isi dengan domain Vercel Anda).
4. Deploy. Di Supabase **Authentication → URL Configuration**:
   - Site URL: `https://<domain-anda>`
   - Redirect URLs: tambahkan `https://<domain-anda>/**`
5. Jalankan migrasi + bootstrap Super Admin di proyek Supabase **production**.
6. Uji: login, tiap role, halaman publik, satu transaksi, cetak label.

### Rollback

- **Frontend:** Vercel → Deployments → pilih deployment sebelumnya → **Promote to Production**.
- **Database:** kembalikan dengan `supabase db reset` ke migrasi terakhir yang sehat
  di environment development dulu, atau restore dari backup. Jangan rollback
  migrasi destruktif di production tanpa backup.

### Backup database

Supabase Dashboard → **Database → Backups**: aktifkan Point-in-Time Recovery
(paket Pro) atau unduh backup harian. Untuk restore: gunakan file backup di
SQL Editor / `pg_restore` sesuai panduan Supabase.

---

## 7. Catatan keamanan

- RLS aktif di semua tabel; `anon` hanya lewat RPC publik (`get_public_asset`,
  `search_public_assets`) yang mengembalikan kolom whitelist saja.
- Semua permission dicek di database (`has_permission()`); UI hanya cerminan.
- Transaksi stok hanya via RPC atomik (row lock, idempotency key, validasi stok di Postgres).
- QR code hanya berisi URL publik — tanpa harga, serial, token, atau data rahasia.
- Jangan commit file `.env`.
