# Panduan Auto-Backup Mingguan & Restore AssetFlow

Sistem ini menyediakan template workflow GitHub Actions **`docs/weekly-backup.yml`** (untuk dipasang di **`.github/workflows/weekly-backup.yml`**) guna menjalankan backup penuh **seminggu sekali** secara otomatis setiap **Minggu pukul 02:00 WIB** (`0 19 * * 6` UTC), serta bisa dipicu manual kapan saja lewat tombol **Run workflow**.

---

## 1. Apa yang Di-backup?

Setiap eksekusi menghasilkan satu arsip terenkripsi **`assetflow-backup-YYYY-MM-DD_HHMMZ.tar.gz.enc`** berisi:

1. **Database PostgreSQL (`db/`)**
   - `db-all-app.dump` — dump lengkap schema `public`, `auth`, `storage` (metadata), dan `supabase_migrations`.
   - `db-public.dump` — dump khusus schema `public` (tabel aplikasi, fungsi RPC, trigger, RLS, counter).
   - `db-auth-storage-data.dump` — data `auth` & metadata `storage` (`--data-only`, aman untuk restore ke project Supabase baru).
   - `db-counts.txt` & `db-public.toc.txt` — jumlah baris tabel utama & daftar objek sebagai bukti integritas.
2. **Supabase Storage (`storage/`)**
   - Seluruh file di semua bucket (`surat-jalan`, `asset-photos`, `item-photos`) diunduh oleh `scripts/backup-storage.mjs`, disertai `storage-manifest.json`.
3. **Enkripsi & Penyimpanan**
   - Diarsipkan (`tar.gz`), lalu dienkripsi **AES-256-CBC (PBKDF2 600.000 iterasi)** memakai `BACKUP_ENCRYPTION_KEY` sebelum disimpan di **GitHub Actions Artifacts** selama **90 hari** (~12–13 snapshot mingguan terakhir).
   - **Penting:** Repository ini bersifat *public*, sehingga workflow **wajib** memakai `BACKUP_ENCRYPTION_KEY` agar data gudang, harga, dan akun pengguna tidak pernah tersimpan dalam bentuk terbuka.

---

## 2. Pengaturan Awal (Sekali Saja di GitHub)

### Langkah A — Pasang File Workflow di GitHub
*(Diperlukan langsung oleh pemilik repo di browser karena GitHub memblokir GitHub App untuk push ke folder `.github/workflows/`.)*
1. Buka `docs/weekly-backup.yml` di repo ini dan salin seluruh isinya.
2. Buka tautan berikut untuk membuat file baru langsung di `main`:
   `https://github.com/saintanggi/assetflow/new/main?filename=.github/workflows/weekly-backup.yml`
3. Tempel isi `docs/weekly-backup.yml`, lalu klik **Commit changes… → Commit directly to the `main` branch**.

### Langkah B — Isi 4 Secrets di GitHub
Buka **Settings → Secrets and variables → Actions → New repository secret** (atau langsung `https://github.com/saintanggi/assetflow/settings/secrets/actions/new`), lalu tambahkan **4 secret** berikut:

| Nama Secret | Cara Mendapatkan | Catatan Penting |
|---|---|---|
| `SUPABASE_DB_URL` | Supabase Dashboard → **Connect** (tombol atas) → **Method: Session pooler** (`port 5432`) | **Wajib pakai Session Pooler** (`aws-0-ap-southeast-1.pooler.supabase.com:5432`), **bukan** direct host `db.*.supabase.co` karena runner GitHub Actions tidak punya jalur IPv6. Jangan pakai Transaction pooler port `6543`. |
| `SUPABASE_URL` | Supabase Dashboard → **Project Settings → Data API → Project URL** | Contoh: `https://vzkvmbydnwcjdthdqcdi.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → **Project Settings → API Keys → `service_role`** | Diperlukan untuk mengunduh bucket privat (`surat-jalan`) dan membaca seluruh bucket Storage. |
| `BACKUP_ENCRYPTION_KEY` | Buat passphrase acak yang panjang (mis. 32+ karakter) dan simpan juga di password manager tim | **Jangan sampai hilang** — tanpa kunci ini arsip `.tar.gz.enc` tidak bisa dibuka. |

### Uji Jalankan Manual
1. Buka tab **Actions** di GitHub → pilih workflow **Weekly Backup**.
2. Klik **Run workflow** → pilih branch `main` → **Run workflow**.
3. Setelah status hijau (~1–2 menit), klik run tersebut → lihat tabel ringkasan di **Summary** dan unduh file di bagian **Artifacts**.

---

## 3. Cara Dekripsi & Restore Saat Dibutuhkan

### A. Unduh & Dekripsi Arsip
1. Unduh artifact `assetflow-backup-...` dari GitHub Actions dan ekstrak `.zip`-nya sehingga muncul file `.tar.gz.enc` (dan `.sha256`).
2. Jalankan:
   ```bash
   ./scripts/decrypt-backup.sh assetflow-backup-2026-11-29_1900Z.tar.gz.enc ./hasil-restore
   ```
   *(atau manual dengan OpenSSL)*:
   ```bash
   openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
     -in assetflow-backup-2026-11-29_1900Z.tar.gz.enc \
     -pass pass:"PASS_ANDA" | tar -C ./hasil-restore -xzf -
   ```

### B. Restore Database ke Project Supabase Baru
Gunakan **Session Pooler URL** (`port 5432`) milik project Supabase tujuan dan `pg_restore` versi 17:

```bash
TARGET_DB_URL="postgresql://postgres.<ref>:<password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require"

# 1) Restore seluruh tabel, fungsi RPC, trigger, dan RLS schema public
pg_restore --clean --if-exists --no-owner --no-privileges \
  -d "$TARGET_DB_URL" \
  ./hasil-restore/assetflow-backup-*/db/db-public.dump

# 2) Restore data user Auth & metadata Storage (ke schema auth/storage bawaan Supabase)
pg_restore --data-only --disable-triggers --no-owner --no-privileges \
  -d "$TARGET_DB_URL" \
  ./hasil-restore/assetflow-backup-*/db/db-auth-storage-data.dump
```

### C. Restore File Foto Storage
Isi seluruh bucket ada di `./hasil-restore/assetflow-backup-*/storage/<nama-bucket>/` (beserta `storage-manifest.json`). Unggah kembali ke bucket terkait via Supabase Dashboard → **Storage** atau Supabase CLI/API sesuai path folder aslinya.
