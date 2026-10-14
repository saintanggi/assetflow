-- Tabel akun operasional: login pakai username + password (tanpa email).
-- Auth tetap via Supabase Auth (email internal username@inventory.internal).

CREATE TABLE IF NOT EXISTS public.user_accounts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username     text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_.-]{3,30}$'),
  auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  role         text NOT NULL CHECK (role IN ('super_admin', 'admin_ho', 'admin_gudang', 'helper')),
  display_name text NOT NULL,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES auth.users(id),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_accounts_username ON public.user_accounts(username);
CREATE INDEX IF NOT EXISTS idx_user_accounts_auth ON public.user_accounts(auth_user_id);

-- RLS: hanya super_admin yang bisa kelola.
ALTER TABLE public.user_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_accounts superadmin all"
ON public.user_accounts FOR ALL
USING (public.has_permission('users.manage'))
WITH CHECK (public.has_permission('users.manage'));

-- Semua user login bisa baca akunnya sendiri (untuk mapping username).
CREATE POLICY "user_accounts self read"
ON public.user_accounts FOR SELECT
USING (auth_user_id = auth.uid());

-- Permission baru untuk kelola user.
-- (Ditambahkan ke role super_admin via seed permissions bila ada tabelnya.)

COMMENT ON TABLE public.user_accounts IS 'Akun operasional login username+password. Auth via Supabase Auth (email internal).';
