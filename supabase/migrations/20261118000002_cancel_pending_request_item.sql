-- 20261118000002 — RPC batalkan/hapus item sisa belum terkirim (khusus super admin).
--
-- Request Anggi 18 Nov 2026: menu Sisa Belum Terkirim belum bisa hapus —
-- barang yang di-cancel kirimnya susah dihapus.
--
-- Menghapus SATU baris request_items yang masih pending (pending_sebagian /
-- menunggu_stok). Baris yang sudah terkirim tidak bisa dihapus lewat sini.
-- Stok TIDAK berubah: barang pending belum pernah mengurangi stok, dan tidak
-- ada FK yang mengacu ke request_items, jadi hapus baris aman.
-- Kalau setelah dihapus permintaannya tidak punya item lagi (belum ada yang
-- terkirim sama sekali), permintaannya ikut dihapus supaya tidak tertinggal
-- tiket kosong di daftar Permintaan. FK request_items & sheet_sync_changes
-- ke requests ON DELETE CASCADE, jadi ikut bersih.

CREATE OR REPLACE FUNCTION public.cancel_pending_request_item(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_item record;
  v_req record;
  v_remaining int;
  v_request_deleted boolean := false;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Hanya super admin yang bisa menghapus sisa belum terkirim';
  END IF;

  SELECT * INTO v_item FROM public.request_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item tidak ditemukan';
  END IF;
  IF v_item.item_status NOT IN ('pending_sebagian', 'menunggu_stok') THEN
    RAISE EXCEPTION 'Hanya item yang masih pending (belum terkirim) yang bisa dihapus (status: %)', v_item.item_status;
  END IF;

  SELECT * INTO v_req FROM public.requests WHERE id = v_item.request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Permintaan tidak ditemukan';
  END IF;

  DELETE FROM public.request_items WHERE id = p_item_id;

  SELECT COUNT(*) INTO v_remaining FROM public.request_items WHERE request_id = v_item.request_id;
  IF v_remaining = 0 THEN
    DELETE FROM public.requests WHERE id = v_item.request_id;
    v_request_deleted := true;
  END IF;

  RETURN jsonb_build_object(
    'request_number', v_req.request_number,
    'ticket_no', v_req.ticket_no,
    'request_deleted', v_request_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_pending_request_item(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_pending_request_item(uuid) TO authenticated;
