-- FIX: has_permission() harus kenal akun operasional (user_accounts).
-- Akun helper/admin_ho/admin_gudang tidak punya baris di profiles,
-- sehingga semua RLS memblokir mereka. Fungsi ini sekarang cek
-- user_accounts dulu dengan permission map per role.

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
  v_role     text;
  v_perms    text[];
BEGIN
  IF v_user IS NULL THEN
    RETURN false;
  END IF;

  -- 1) Cek akun operasional dulu.
  SELECT ua.role, ua.is_active INTO v_role, v_active
  FROM public.user_accounts ua
  WHERE ua.auth_user_id = v_user;

  IF v_role IS NOT NULL THEN
    IF NOT COALESCE(v_active, false) THEN
      RETURN false;
    END IF;
    -- Permission map per role operasional.
    v_perms := CASE v_role
      WHEN 'super_admin'  THEN ARRAY['*']
      WHEN 'admin_ho'      THEN ARRAY['requests.view', 'requests.create']
      WHEN 'admin_gudang'  THEN ARRAY['requests.view', 'requests.review', 'requests.approve', 'inventory.view']
      WHEN 'helper'        THEN ARRAY['requests.view', 'requests.process']
      ELSE ARRAY[]::text[]
    END;
    IF v_perms @> ARRAY['*'] THEN
      RETURN true;
    END IF;
    RETURN v_perms @> ARRAY[p_code];
  END IF;

  -- 2) Fallback ke sistem lama (profiles/roles).
  SELECT p.is_active INTO v_active
  FROM public.profiles p
  WHERE p.id = v_user;

  IF NOT COALESCE(v_active, false) THEN
    RETURN false;
  END IF;

  IF public.is_super_admin() THEN
    RETURN true;
  END IF;

  SELECT up.granted INTO v_override
  FROM public.user_permissions up
  JOIN public.permissions pm ON pm.id = up.permission_id
  WHERE up.user_id = v_user
    AND pm.code = p_code;

  IF v_override IS NOT NULL THEN
    RETURN v_override;
  END IF;

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

-- is_super_admin() juga harus kenal user_accounts.
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RETURN false;
  END IF;
  -- Akun operasional super_admin.
  IF EXISTS (
    SELECT 1 FROM public.user_accounts ua
    WHERE ua.auth_user_id = v_user AND ua.role = 'super_admin' AND ua.is_active
  ) THEN
    RETURN true;
  END IF;
  -- Sistem lama.
  RETURN EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.roles r ON r.id = p.role_id
    WHERE p.id = v_user AND r.name = 'super_admin' AND p.is_active
  );
END;
$$;
