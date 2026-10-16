-- Pemeriksaan READ-ONLY: verifikasi pemasangan script penghapusan.
-- Jalankan di Supabase Dashboard -> SQL Editor -> New query -> Run.
-- Tidak menghapus atau mengubah data.

WITH checks AS (
  SELECT
    to_regprocedure('public._admin_purge_inventory_transactions(uuid[])') IS NOT NULL
      AS purge_function,
    to_regprocedure('public.admin_delete_inventory_transaction(uuid)') IS NOT NULL
      AS delete_transaction_rpc,
    to_regprocedure('public.purge_request_inventory_history_before_delete()') IS NOT NULL
      AS request_trigger_function,
    EXISTS (
      SELECT 1
        FROM pg_trigger tr
        JOIN pg_class tbl ON tbl.oid = tr.tgrelid
        JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
       WHERE ns.nspname = 'public'
         AND tbl.relname = 'requests'
         AND tr.tgname = 'trg_purge_request_inventory_history'
         AND NOT tr.tgisinternal
         AND tr.tgenabled <> 'D'
    ) AS request_delete_trigger_enabled,
    EXISTS (
      SELECT 1
        FROM pg_policies pol
       WHERE pol.schemaname = 'public'
         AND pol.tablename = 'requests'
         AND pol.cmd = 'DELETE'
         AND pol.policyname = 'requests_delete'
         AND pol.qual ILIKE '%is_super_admin%'
    ) AS requests_delete_restricted_to_superadmin,
    EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.oid = to_regprocedure('public.admin_delete_inventory_transaction(uuid)')
        AND p.prosecdef
    ) AS transaction_rpc_is_security_definer,
    COALESCE(has_function_privilege(
      'authenticated',
      to_regprocedure('public.admin_delete_inventory_transaction(uuid)'),
      'EXECUTE'
    ), false) AS authenticated_can_call_guarded_rpc
)
SELECT check_name,
       CASE WHEN passed THEN 'OK' ELSE 'BELUM' END AS status
FROM checks
CROSS JOIN LATERAL (VALUES
  ('Fungsi purge transaksi tersedia', purge_function),
  ('RPC hapus transaksi tersedia', delete_transaction_rpc),
  ('Fungsi trigger permintaan tersedia', request_trigger_function),
  ('Trigger hapus permintaan aktif', request_delete_trigger_enabled),
  ('Hapus permintaan dibatasi Super Admin', requests_delete_restricted_to_superadmin),
  ('RPC hapus transaksi memakai SECURITY DEFINER', transaction_rpc_is_security_definer),
  ('RPC dapat dipanggil login (otorisasi Super Admin dicek di dalam fungsi)', authenticated_can_call_guarded_rpc)
) AS result(check_name, passed)
ORDER BY check_name;
