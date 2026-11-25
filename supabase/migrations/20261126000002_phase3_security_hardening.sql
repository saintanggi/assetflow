-- =============================================================================
-- MIGRASI FASE 3: HARDENING KEAMANAN DATABASE, AUDIT IMMUTABILITY & INDEXING
-- Tanggal : 2026-11-26
-- Sifat   : 100% ADDITIVE, IDEMPOTEN, NON-BREAKING (aman untuk data produksi)
--
-- Cakupan:
--   1. Tutup celah akun nonaktif di `is_super_admin()` & `is_staff()` agar
--      user `user_accounts.is_active = false` tidak jatuh ke fallback `profiles`.
--   2. Audit log permanen (append-only): blokir UPDATE/DELETE pada `audit_logs`.
--   3. Kunci `search_path = public, extensions` pada seluruh fungsi
--      `SECURITY DEFINER` di schema `public` yang belum memasangnya.
--   4. Indeks performa untuk query berat (log transaksi, dead stock, antrean,
--      dedup Google Sheet, dan audit log).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Penegakan status aktif pada is_super_admin() & is_staff()
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_role   text;
  v_active boolean;
BEGIN
  IF v_user IS NULL THEN
    RETURN false;
  END IF;

  -- Cek akun operasional terlebih dulu. Jika akun ada tetapi is_active = false,
  -- langsung tolak (JANGAN fallback ke tabel profiles).
  SELECT ua.role, ua.is_active INTO v_role, v_active
    FROM public.user_accounts ua
   WHERE ua.auth_user_id = v_user
   LIMIT 1;

  IF FOUND THEN
    RETURN COALESCE(v_active, false) AND v_role = 'super_admin';
  END IF;

  RETURN EXISTS (
    SELECT 1
      FROM public.profiles p
      JOIN public.roles r ON r.id = p.role_id
     WHERE p.id = v_user
       AND r.name = 'super_admin'
       AND COALESCE(p.is_active, false)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_active boolean;
BEGIN
  IF v_user IS NULL THEN
    RETURN false;
  END IF;

  -- Cek akun operasional dulu: jika nonaktif, langsung tolak tanpa fallback.
  SELECT ua.is_active INTO v_active
    FROM public.user_accounts ua
   WHERE ua.auth_user_id = v_user
   LIMIT 1;

  IF FOUND THEN
    RETURN COALESCE(v_active, false);
  END IF;

  RETURN EXISTS (
    SELECT 1
      FROM public.profiles p
      JOIN public.roles r ON r.id = p.role_id
     WHERE p.id = v_user
       AND COALESCE(p.is_active, false)
       AND r.name IN ('super_admin', 'admin', 'admin_ho', 'admin_gudang', 'helper')
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. Audit Log Permanen (Append-Only / Anti-Tampering)
-- -----------------------------------------------------------------------------
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_audit_logs_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  RAISE EXCEPTION 'Audit log bersifat permanen (append-only) dan tidak boleh diubah atau dihapus';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_audit_logs_immutable();

-- -----------------------------------------------------------------------------
-- 3. Pin `search_path = public, extensions` pada semua fungsi SECURITY DEFINER
--    di schema `public` yang belum memiliki `search_path` eksplisit
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_fn record;
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef = true
       AND NOT EXISTS (
         SELECT 1
           FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) cfg
          WHERE cfg LIKE 'search_path=%'
       )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions', v_fn.sig);
  END LOOP;
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. Indeks Performa (Non-Blocking, Idempoten)
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_inv_txn_date_type_status
  ON public.inventory_transactions (transaction_date DESC, type, status);

CREATE INDEX IF NOT EXISTS idx_inv_txn_reference
  ON public.inventory_transactions (reference)
  WHERE reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inv_ledger_item_created
  ON public.inventory_ledger (item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_request_items_status
  ON public.request_items (item_status);

CREATE INDEX IF NOT EXISTS idx_requests_ticket_date
  ON public.requests (ticket_no, request_date);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
  ON public.audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
  ON public.audit_logs (entity_type, entity_id);
