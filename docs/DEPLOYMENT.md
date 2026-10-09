# Panduan Deployment Inventory Warehouse

## 1. GitHub

```bash
cd assetflow
git add -A
git commit -m "Inventory Warehouse: rilis awal"
git branch -M main
git remote add origin https://github.com/<username>/assetflow.git
git push -u origin main
```

Jangan pernah commit file `.env`. Pastikan `.env.example` selalu mutakhir.

## 2. Proyek Supabase (dev & production)

1. Buat proyek `assetflow-dev` dan `assetflow-prod` di https://supabase.com.
2. Di tiap proyek, buka **SQL Editor** dan jalankan berurutan:
   1. `supabase/migrations/20261009000001_schema.sql`
   2. `supabase/migrations/20261009000002_rls.sql`
   3. `supabase/migrations/20261009000003_functions.sql`
   4. `supabase/migrations/20261009000004_seed.sql`
3. Jalankan `supabase/tests/rls_smoke.sql` — semua skenario penolakan harus lolos.
4. Pastikan ekstensi `pg_trgm` aktif (Database → Extensions).
5. Storage: bucket `asset-photos` dibuat oleh migrasi; verifikasi di Storage → Policies.
6. Authentication → URL Configuration:
   - **Site URL**: URL produksi (mis. `https://assetflow.vercel.app`)
   - **Redirect URLs**: tambahkan URL produksi + `http://localhost:5173` untuk dev.
   - Aktifkan **Confirm email** sesuai kebutuhan; atur template email reset password.

### Bootstrap Super Admin

Ikuti `docs/BOOTSTRAP.md` — buat user pertama via Authentication, lalu jalankan
`public.promote_first_super_admin('email@contoh.com')`. Fungsi menolak jika
Super Admin sudah ada. Ulangi prosedur yang sama di proyek production.

## 3. Deploy frontend ke Vercel

1. Di Vercel → Add New Project → import repo GitHub `assetflow`.
2. Framework preset: **Vite**. Build command: `npm run build`. Output: `dist`.
3. Environment Variables (Production & Preview):
   - `VITE_SUPABASE_URL` → URL proyek **production**
   - `VITE_SUPABASE_ANON_KEY` → anon key proyek **production**
   - `VITE_APP_URL` → URL Vercel production (mis. `https://assetflow.vercel.app`)
   - `VITE_APP_NAME` → `Inventory Warehouse`
4. Deploy. Untuk environment **Preview/Development** di Vercel, gunakan kredensial proyek `assetflow-dev`.

`vercel.json` (SPA fallback) sudah disertakan di repo:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

## 4. HTTPS, backup & restore

- **HTTPS**: otomatis aktif di Vercel (sertifikat dikelola Vercel). Jangan serve aplikasi via HTTP polos.
- **Backup database**: Supabase → Database → Backups (harian otomatis pada paket Pro; paket gratis: lakukan `pg_dump` terjadwal manual/CI).
  ```bash
  pg_dump "postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres" -F c -f assetflow-backup.dump
  ```
- **Restore**: `pg_restore -d <target> assetflow-backup.dump` ke proyek baru, lalu verifikasi migrasi & RLS ulang dengan `rls_smoke.sql`.

## 5. Rollback

### Rollback frontend (Vercel)
Vercel → Deployments → pilih deployment sehat sebelumnya → **Promote to Production**.
Tidak menyentuh database, aman untuk rollback murni UI.

### Rollback database
Migrasi ditulis idempoten dan aditif (tanpa DROP destruktif), sehingga rollback
normalnya **tidak diperlukan**. Jika terjadi kesalahan skema:
1. Jangan jalankan ulang migrasi yang gagal sebagian tanpa memeriksa state.
2. Pulihkan dari backup terakhir ke proyek staging, verifikasi, lalu arahkan aplikasi.
3. Catat koreksi sebagai migrasi baru (jangan edit migrasi lama yang sudah jalan di production).

### Checklist sebelum tandai "selesai"
- [ ] `npm run build` lolos tanpa error
- [ ] Login 3 mode akses berjalan (super_admin / admin / publik)
- [ ] Endpoint publik tidak membocorkan harga, serial privat, atau data internal
- [ ] Transaksi stok konsisten (uji: terima → keluar → transfer → koreksi)
- [ ] QR/barcode tercetak & terpindai
- [ ] Audit log terisi
- [ ] Backup terjadwal aktif
