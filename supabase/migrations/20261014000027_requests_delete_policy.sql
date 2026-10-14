-- 20261014000027 — Izinkan superadmin menghapus requests.
-- BUG: tidak ada policy DELETE di public.requests sehingga hapus
-- permintaan selalu gagal (RLS deny), padahal UI menyediakan tombol hapus.

DROP POLICY IF EXISTS requests_delete ON public.requests;
CREATE POLICY requests_delete ON public.requests
  FOR DELETE TO authenticated
  USING (public.is_super_admin());
