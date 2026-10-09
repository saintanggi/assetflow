# AssetFlow — Bootstrap Super Admin (dari nol)

Panduan membuat akun **Super Admin pertama** dengan aman. Tidak ada kredensial
default di sistem ini — semua akses super admin lahir dari prosedur di bawah.

## Prasyarat

1. Proyek Supabase sudah dibuat (disarankan **dua proyek terpisah**:
   development & production).
2. Migrasi dijalankan **berurutan** di SQL Editor (atau `supabase db push`):
   1. `supabase/migrations/20261009000001_schema.sql`
   2. `supabase/migrations/20261009000002_rls.sql`
   3. `supabase/migrations/20261009000003_functions.sql`
   4. `supabase/migrations/20261009000004_seed.sql`
3. (Opsional tapi disarankan) Jalankan `supabase/tests/rls_smoke.sql` dan
   pastikan semua test `lolos = true`.

## Langkah-langkah

### 1. Buat user pertama via Supabase Auth

Dashboard > **Authentication** > **Users** > **Add user** > **Create new user**:

- Isi **Email** (mis. `pemilik@perusahaan.com`) dan **Password** (simpan di
  password manager — ini kredensial milikmu, bukan default sistem).
- Centang **Auto Confirm User**.
- Klik **Create user**.

> Trigger `handle_new_user()` otomatis membuat baris `profiles` untuk user ini
> **tanpa role** — ia belum bisa apa-apa sampai langkah 2.

### 2. Jalankan fungsi bootstrap

Dashboard > **SQL Editor** > **New query**:

1. Salin seluruh isi `supabase/bootstrap/superadmin.sql`, jalankan sekali
   (ini hanya *membuat* fungsi `promote_first_super_admin`, belum mempromosikan).
2. Ganti email, lalu jalankan:

```sql
SELECT public.promote_first_super_admin('pemilik@perusahaan.com');
```

Fungsi ini **menolak** (exception) bila:

- sudah ada super_admin aktif — sehingga tidak bisa dipakai untuk
  mengambil alih sistem;
- email tidak ditemukan di `profiles` — buat dulu user-nya (langkah 1).

### 3. Verifikasi

```sql
-- Harus 1 baris: user tersebut dengan role super_admin & aktif.
SELECT p.email, p.full_name, r.name AS role, p.is_active
FROM public.profiles p
JOIN public.roles r ON r.id = p.role_id
WHERE r.name = 'super_admin';

-- Sanity: helper mengenali (jalankan sambil login sebagai user itu
-- dari aplikasi, atau cek via audit log di bawah).
SELECT * FROM public.audit_logs
WHERE entity_type = 'profiles'
ORDER BY created_at DESC LIMIT 5;
```

Lalu login ke aplikasi dengan email/password tersebut — kamu harus melihat
menu Super Admin (Pengguna, Audit Log, Pengaturan, dsb).

### 4. (Disarankan) Hapus fungsi bootstrap

Setelah super_admin pertama aktif, fungsi ini tidak lagi dibutuhkan dan
sebaiknya dihapus untuk menghilangkan permukaan serangan:

```sql
DROP FUNCTION IF EXISTS public.promote_first_super_admin(text);
```

Super_admin berikutnya **tidak** lewat file ini lagi, melainkan dibuat oleh
super_admin yang sudah ada melalui halaman **Pengguna** di aplikasi
(atau SQL manual oleh super_admin).

### 5. Amankan Auth untuk production

Dashboard > **Authentication** > **URL Configuration**:

- **Site URL**: `https://assetflow.vercel.app` (domain production).
- **Redirect URLs**: tambahkan domain production (dan `http://localhost:5173`
  hanya untuk development).

Dashboard > **Authentication** > **Sign In / Up**: matikan **Allow new users
to sign up** jika pendaftaran mandiri tidak diinginkan (user dibuat oleh
super_admin via dashboard).

## Troubleshooting

| Gejala | Penyebab & solusi |
|---|---|
| `Profile dengan email ... tidak ditemukan` | User Auth belum dibuat / email salah ketik. Ulangi langkah 1. Cek: `SELECT id, email FROM auth.users;` |
| `Bootstrap DITOLAK: sudah ada N super_admin aktif` | Sistem sudah punya super_admin. Login sebagai dia untuk mengelola user. Jika super_admin lama hilang akses, gunakan **recovery email** Supabase Auth untuk user itu, bukan bootstrap ulang. |
| `permission denied for table profiles` saat verifikasi | Query verifikasi dijalankan sebagai role tanpa hak. Jalankan di SQL Editor sebagai pemilik proyek (role postgres), atau login sebagai super_admin di aplikasi. |
| User baru daftar tapi tidak bisa login ke apa pun | Normal: `role_id` NULL sampai super_admin menetapkan role di halaman Pengguna. |
| Lupa password super_admin | Dashboard > Authentication > Users > pilih user > **Send password reset** (atau fitur Lupa Password di aplikasi). |

## Catatan keamanan

- Jangan pernah menaruh service-role key / database password di frontend —
  hanya di server/CI sebagai environment variable (lihat `.env.example`).
- File `.env` asli tidak di-commit (cek `.gitignore`).
- Audit log mencatat promosi bootstrap (`entity_type='profiles'`,
  `actor_id` NULL karena dijalankan dari SQL Editor) — bisa diverifikasi
  kapan pun oleh super_admin.
