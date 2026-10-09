-- =============================================================
-- AssetFlow — Bootstrap Super Admin (AMAN)
-- File: supabase/bootstrap/superadmin.sql
-- =============================================================
-- FUNGSI file ini:
--   Mempromosikan SATU alamat email menjadi super_admin, HANYA JIKA
--   belum ada super_admin aktif sama sekali di database.
--
-- JAMINAN KEAMANAN:
--   * Tidak ada kredensial default di mana pun.
--   * Tidak ada endpoint publik / API untuk menjadikan seseorang
--     super_admin — hanya fungsi SQL ini, dijalankan manual oleh
--     pemilik proyek di Supabase SQL Editor (akses dashboard).
--   * Jika sudah ada super_admin (bahkan 1), fungsi MENOLAK dengan
--     exception — tidak bisa dipakai untuk mengambil alih.
--   * Setelah bootstrap selesai, fungsi ini boleh di-DROP (lihat bawah).
--
-- PRASYARAT (urutan):
--   1. Migrasi 000001..000004 sudah dijalankan berurutan.
--   2. User pertama sudah dibuat via Supabase Dashboard
--      (Authentication > Users > Add user > Create new user),
--      atau sudah sign-up lewat aplikasi.
--      -> trigger handle_new_user otomatis membuat baris profiles
--         untuk user tersebut (tanpa role).
--
-- CARA PAKAI:
--   1. Buka file ini di Supabase SQL Editor, jalankan sekali untuk
--      membuat fungsi promote_first_super_admin().
--   2. Ganti 'pemilik@perusahaan.com' dengan email user pertama,
--      lalu jalankan baris SELECT di bagian bawah file ini.
--   3. Verifikasi dengan query di docs/BOOTSTRAP.md.
--   4. (Opsional tapi disarankan) DROP fungsi ini setelah berhasil.
-- =============================================================

CREATE OR REPLACE FUNCTION public.promote_first_super_admin(p_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_count      int;
  v_profile_id uuid;
  v_email      text := btrim(COALESCE(p_email, ''));
BEGIN
  IF v_email = '' THEN
    RAISE EXCEPTION 'Email tidak boleh kosong';
  END IF;

  -- Kunci: hanya boleh jika BELUM ADA super_admin aktif sama sekali.
  SELECT count(*) INTO v_count
  FROM public.profiles p
  JOIN public.roles r ON r.id = p.role_id
  WHERE r.name = 'super_admin'
    AND p.is_active;

  IF v_count > 0 THEN
    RAISE EXCEPTION
      'Bootstrap DITOLAK: sudah ada % super_admin aktif. '
      'Penambahan super_admin berikutnya hanya bisa dilakukan oleh super_admin yang ada, '
      'melalui halaman Pengguna di aplikasi.',
      v_count;
  END IF;

  -- Profil harus sudah ada (dibuat saat user Auth dibuat).
  SELECT p.id INTO v_profile_id
  FROM public.profiles p
  WHERE lower(p.email) = lower(v_email);

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Profile dengan email % tidak ditemukan. '
      'Buat dulu user-nya via Dashboard > Authentication > Users, lalu ulangi.',
      v_email;
  END IF;

  -- Promosikan. Trigger guard_profile_privilege mengizinkan karena
  -- fungsi ini SECURITY DEFINER dengan auth.uid() IS NULL (konteks
  -- SQL Editor pemilik proyek); RLS tidak menghalangi owner.
  UPDATE public.profiles
     SET role_id   = (SELECT id FROM public.roles WHERE name = 'super_admin'),
         is_active = true,
         updated_at = now()
   WHERE id = v_profile_id;

  RAISE NOTICE 'OK: % sekarang adalah super_admin.', v_email;
END;
$$;

-- Fungsi ini alat sekali pakai milik pemilik proyek: jangan expose ke API.
REVOKE ALL ON FUNCTION public.promote_first_super_admin(text) FROM PUBLIC;

-- =============================================================
-- LANGKAH 2: ganti email di bawah, lalu jalankan (satu baris ini saja)
-- =============================================================
-- SELECT public.promote_first_super_admin('pemilik@perusahaan.com');

-- =============================================================
-- LANGKAH 4 (opsional, disarankan): hapus fungsi setelah bootstrap
-- =============================================================
-- DROP FUNCTION IF EXISTS public.promote_first_super_admin(text);
