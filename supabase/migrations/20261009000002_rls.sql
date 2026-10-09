-- =============================================================
-- AssetFlow — Migrasi 000002: Helper otorisasi + RLS + Storage
-- =============================================================
-- Prinsip:
--   * Helper is_super_admin()/is_staff()/has_permission() adalah
--     SECURITY DEFINER dengan search_path tetap -> membaca tabel
--     profiles/roles TANPA memicu rekursi RLS.
--   * anon: TIDAK ada SELECT langsung ke tabel privat. Akses publik
--     hanya lewat RPC get_public_asset / search_public_assets.
--   * GRANT diberikan luas ke role authenticated, pengetatan dilakukan
--     oleh kebijakan RLS (pola standar Supabase/PostgREST).
--   * Tidak ada view yang melewati RLS (tidak ada view sama sekali).
-- =============================================================

-- =============================================================
-- 1. HELPER OTORISASI (SECURITY DEFINER, search_path tetap)
-- =============================================================
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.roles r ON r.id = p.role_id
    WHERE p.id = auth.uid()
      AND p.is_active
      AND r.name = 'super_admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.roles r ON r.id = p.role_id
    WHERE p.id = auth.uid()
      AND p.is_active
      AND r.name IN ('super_admin', 'admin')
  );
$$;

-- has_permission: super_admin -> true untuk semua kode.
-- Selain itu: override per-user (user_permissions) menang atas role;
-- granted=false eksplisit berarti DITOLAK meski role mengizinkan.
CREATE OR REPLACE FUNCTION public.has_permission(p_code text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user     uuid := auth.uid();
  v_active   boolean;
  v_override boolean;
BEGIN
  IF v_user IS NULL THEN
    RETURN false;
  END IF;

  SELECT p.is_active INTO v_active
  FROM public.profiles p
  WHERE p.id = v_user;

  -- Profil tidak ada / nonaktif -> tidak punya permission apa pun.
  IF NOT COALESCE(v_active, false) THEN
    RETURN false;
  END IF;

  IF public.is_super_admin() THEN
    RETURN true;
  END IF;

  -- Override per-user (boleh diberikan/dicabut oleh Super Admin).
  SELECT up.granted INTO v_override
  FROM public.user_permissions up
  JOIN public.permissions pm ON pm.id = up.permission_id
  WHERE up.user_id = v_user
    AND pm.code = p_code;

  IF v_override IS NOT NULL THEN
    RETURN v_override;
  END IF;

  -- Permission dari role.
  RETURN EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.role_permissions rp ON rp.role_id = p.role_id
    JOIN public.permissions pm ON pm.id = rp.permission_id
    WHERE p.id = v_user
      AND pm.code = p_code
  );
END;
$$;

-- =============================================================
-- 2. GRANT (pengetatan nyata dilakukan oleh RLS di bawah)
-- =============================================================
-- Hardening: cabut hak CREATE pada schema public agar search_path
-- fungsi SECURITY DEFINER tidak bisa dibajak via objek bayangan.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- Hak DML luas untuk authenticated; RLS yang membatasi baris/operasi.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Berlaku juga untuk tabel yang dibuat migrasi berikutnya.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated;

-- Helper hanya boleh dipanggil oleh user login (kebijakan RLS).
REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_staff() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(text) TO authenticated;

-- =============================================================
-- 3. AKTIFKAN RLS DI SEMUA TABEL
-- =============================================================
ALTER TABLE public.roles                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_permissions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_categories           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouses                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.units                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_balances         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transactions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transaction_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_ledger           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_movements            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_counts               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_count_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings               ENABLE ROW LEVEL SECURITY;

-- =============================================================
-- 4. KEBIJAKAN RLS
-- Catatan: tidak ada kebijakan untuk anon di tabel privat -> anon
-- ditolak total. Kebijakan di bawah semuanya TO authenticated.
-- =============================================================

-- Idempotency: hapus semua policy lama di tabel kontrak sebelum buat ulang,
-- sehingga migrasi ini aman dijalankan ulang.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'roles','permissions','role_permissions','profiles','user_permissions',
        'asset_categories','warehouses','locations','units','departments','suppliers',
        'assets','inventory_items','inventory_balances',
        'inventory_transactions','inventory_transaction_items','inventory_ledger',
        'asset_movements','stock_counts','stock_count_items',
        'audit_logs','app_settings')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- ---------- roles / permissions / role_permissions ----------
-- Baca: semua user login. Tulis: super_admin saja.
CREATE POLICY roles_select ON public.roles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY roles_write ON public.roles
  FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

CREATE POLICY permissions_select ON public.permissions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY permissions_write ON public.permissions
  FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

CREATE POLICY role_permissions_select ON public.role_permissions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY role_permissions_write ON public.role_permissions
  FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- ---------- user_permissions ----------
-- Baca: baris sendiri atau super_admin. Tulis: super_admin saja.
-- (Karena tulis = super_admin saja, permission assets.publish otomatis
-- hanya bisa diberikan oleh Super Admin; diperkuat trigger di 000003.)
CREATE POLICY user_permissions_select ON public.user_permissions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin());
CREATE POLICY user_permissions_write ON public.user_permissions
  FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- ---------- profiles ----------
-- Baca: profil sendiri, atau super_admin (semua), atau staff membaca
-- daftar user AKTIF (untuk halaman Pengguna).
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR public.is_super_admin()
    OR (public.is_staff() AND is_active)
  );

-- Tulis: super_admin, atau pemegang users.manage (buat/kelola akun),
-- atau user mengubah profilnya sendiri (nama). Perubahan role_id /
-- is_active oleh non-super_admin dicegah trigger guard di 000003.
CREATE POLICY profiles_insert ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin() OR public.has_permission('users.manage'));

CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR public.has_permission('users.manage')
    OR id = auth.uid()
  )
  WITH CHECK (
    public.is_super_admin()
    OR public.has_permission('users.manage')
    OR id = auth.uid()
  );

CREATE POLICY profiles_delete ON public.profiles
  FOR DELETE TO authenticated
  USING (public.is_super_admin());

-- ---------- master data ----------
-- Baca: staff. Tulis: super_admin saja (kelola kategori, gudang, lokasi,
-- satuan, pemasok, departemen adalah wewenang Super Admin).
CREATE POLICY asset_categories_select ON public.asset_categories
  FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY asset_categories_write ON public.asset_categories
  FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

CREATE POLICY warehouses_select ON public.warehouses
  FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY warehouses_write ON public.warehouses
  FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

CREATE POLICY locations_select ON public.locations
  FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY locations_write ON public.locations
  FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

CREATE POLICY units_select ON public.units
  FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY units_write ON public.units
  FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

CREATE POLICY departments_select ON public.departments
  FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY departments_write ON public.departments
  FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

CREATE POLICY suppliers_select ON public.suppliers
  FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY suppliers_write ON public.suppliers
  FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- ---------- assets ----------
-- SELECT/INSERT/UPDATE sesuai permission. DELETE: tidak ada kebijakan
-- -> hard delete ditolak untuk semua orang; arsip via archived=true
-- (butuh assets.archive, ditegakkan trigger di 000003).
CREATE POLICY assets_select ON public.assets
  FOR SELECT TO authenticated USING (public.has_permission('assets.view'));
CREATE POLICY assets_insert ON public.assets
  FOR INSERT TO authenticated WITH CHECK (public.has_permission('assets.create'));
CREATE POLICY assets_update ON public.assets
  FOR UPDATE TO authenticated
  USING (public.has_permission('assets.update'))
  WITH CHECK (public.has_permission('assets.update'));

-- ---------- inventory_items ----------
-- CRUD item memakai inventory.receive (penerimaan = momen SKU baru dibuat).
-- Arsip (is_active=false) juga lewat permission yang sama. DELETE ditolak
-- (tidak ada kebijakan) karena item punya riwayat transaksi.
CREATE POLICY inventory_items_select ON public.inventory_items
  FOR SELECT TO authenticated USING (public.has_permission('inventory.view'));
CREATE POLICY inventory_items_insert ON public.inventory_items
  FOR INSERT TO authenticated WITH CHECK (public.has_permission('inventory.receive'));
CREATE POLICY inventory_items_update ON public.inventory_items
  FOR UPDATE TO authenticated
  USING (public.has_permission('inventory.receive'))
  WITH CHECK (public.has_permission('inventory.receive'));

-- ---------- inventory_balances ----------
-- Hanya baca. Penulisan saldo HANYA lewat RPC SECURITY DEFINER
-- (post/reverse/finalize) yang mem-bypass RLS sebagai owner.
CREATE POLICY inventory_balances_select ON public.inventory_balances
  FOR SELECT TO authenticated USING (public.has_permission('inventory.view'));

-- ---------- inventory_transactions ----------
-- Baca: inventory.view. Tulis langsung: DITOLAK (tidak ada kebijakan
-- INSERT/UPDATE/DELETE) — semua posting lewat RPC atomik di 000003,
-- koreksi lewat reverse_inventory_transaction. Histori tidak bisa
-- diubah/dihapus diam-diam.
CREATE POLICY inventory_transactions_select ON public.inventory_transactions
  FOR SELECT TO authenticated USING (public.has_permission('inventory.view'));

-- ---------- inventory_transaction_items ----------
CREATE POLICY inventory_transaction_items_select ON public.inventory_transaction_items
  FOR SELECT TO authenticated USING (public.has_permission('inventory.view'));

-- ---------- inventory_ledger ----------
-- Append-only: baca saja, tulis hanya via RPC (SECURITY DEFINER).
CREATE POLICY inventory_ledger_select ON public.inventory_ledger
  FOR SELECT TO authenticated USING (public.has_permission('inventory.view'));

-- ---------- asset_movements ----------
-- Riwayat: baca dengan assets.view; catat dengan assets.update.
-- Tidak bisa diubah/dihapus (tidak ada kebijakan UPDATE/DELETE).
CREATE POLICY asset_movements_select ON public.asset_movements
  FOR SELECT TO authenticated USING (public.has_permission('assets.view'));
CREATE POLICY asset_movements_insert ON public.asset_movements
  FOR INSERT TO authenticated WITH CHECK (public.has_permission('assets.update'));

-- ---------- stock_counts ----------
-- Kelola dengan inventory.adjust. Finalisasi (posted) HANYA via RPC
-- finalize_stock_count; WITH CHECK menolak status='posted' langsung.
CREATE POLICY stock_counts_select ON public.stock_counts
  FOR SELECT TO authenticated USING (public.has_permission('inventory.view'));
CREATE POLICY stock_counts_insert ON public.stock_counts
  FOR INSERT TO authenticated WITH CHECK (public.has_permission('inventory.adjust'));
CREATE POLICY stock_counts_update ON public.stock_counts
  FOR UPDATE TO authenticated
  USING (public.has_permission('inventory.adjust') AND status = 'draft')
  WITH CHECK (public.has_permission('inventory.adjust') AND status = 'draft');
CREATE POLICY stock_counts_delete ON public.stock_counts
  FOR DELETE TO authenticated
  USING (public.has_permission('inventory.adjust') AND status = 'draft');

-- ---------- stock_count_items ----------
-- Hanya untuk opname draft + pemegang inventory.adjust.
CREATE POLICY stock_count_items_select ON public.stock_count_items
  FOR SELECT TO authenticated USING (public.has_permission('inventory.view'));
CREATE POLICY stock_count_items_insert ON public.stock_count_items
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission('inventory.adjust')
    AND EXISTS (
      SELECT 1 FROM public.stock_counts sc
      WHERE sc.id = stock_count_id AND sc.status = 'draft'
    )
  );
CREATE POLICY stock_count_items_update ON public.stock_count_items
  FOR UPDATE TO authenticated
  USING (
    public.has_permission('inventory.adjust')
    AND EXISTS (
      SELECT 1 FROM public.stock_counts sc
      WHERE sc.id = stock_count_id AND sc.status = 'draft'
    )
  )
  WITH CHECK (
    public.has_permission('inventory.adjust')
    AND EXISTS (
      SELECT 1 FROM public.stock_counts sc
      WHERE sc.id = stock_count_id AND sc.status = 'draft'
    )
  );
CREATE POLICY stock_count_items_delete ON public.stock_count_items
  FOR DELETE TO authenticated
  USING (
    public.has_permission('inventory.adjust')
    AND EXISTS (
      SELECT 1 FROM public.stock_counts sc
      WHERE sc.id = stock_count_id AND sc.status = 'draft'
    )
  );

-- ---------- audit_logs ----------
-- SELECT: super_admin saja. INSERT: super_admin, atau trigger/fungsi
-- (SECURITY DEFINER mem-bypass RLS). UPDATE/DELETE: tidak ada kebijakan
-- -> audit log tidak bisa diubah/dihapus siapa pun.
CREATE POLICY audit_logs_select ON public.audit_logs
  FOR SELECT TO authenticated USING (public.is_super_admin());
CREATE POLICY audit_logs_insert ON public.audit_logs
  FOR INSERT TO authenticated WITH CHECK (public.is_super_admin());

-- ---------- app_settings ----------
-- Baca: semua user login. Tulis: super_admin saja.
CREATE POLICY app_settings_select ON public.app_settings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY app_settings_write ON public.app_settings
  FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- =============================================================
-- 5. STORAGE: bucket asset-photos
-- Batas 5MB & image/* TIDAK bisa ditegakkan di SQL murni
-- (metadata file tidak andal saat evaluasi policy) -> ditegakkan di
-- aplikasi (upload) + dokumentasi docs/DATABASE.md.
-- =============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('asset-photos', 'asset-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "AssetFlow asset-photos public read" ON storage.objects;
CREATE POLICY "AssetFlow asset-photos public read"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'asset-photos');

DROP POLICY IF EXISTS "AssetFlow asset-photos authenticated insert" ON storage.objects;
CREATE POLICY "AssetFlow asset-photos authenticated insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'asset-photos');

DROP POLICY IF EXISTS "AssetFlow asset-photos owner update" ON storage.objects;
CREATE POLICY "AssetFlow asset-photos owner update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'asset-photos' AND owner = auth.uid())
  WITH CHECK (bucket_id = 'asset-photos' AND owner = auth.uid());

DROP POLICY IF EXISTS "AssetFlow asset-photos owner delete" ON storage.objects;
CREATE POLICY "AssetFlow asset-photos owner delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'asset-photos' AND owner = auth.uid());
