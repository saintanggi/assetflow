-- Atur Stok: Stok Awal diubah, Stok Akhir mengikuti IN/OUT dari Log.
-- 23 Nov 2026 (permintaan Anggi): "kalo saya ada rubah data stok awal ...
-- stok akhir nya harus mengikuti jumlah IN dan OUT nya juga agar tidak
-- ngaco lagi ledger nya, karna takut ada miss saat SO gudang".
--
-- Riwayat fungsi ini:
--   15 Okt 2026 (20261015000028): rumus Stok Akhir = Stok Awal + pergerakan
--     bersih Log (SUM ledger) — perilaku yang diminta Anggi sekarang.
--   2 Nov 2026 (20261102000001): diganti set langsung (qty = opening = angka
--     input, tanpa jejak) atas permintaan Anggi saat itu ("tidak usah
--     bertambah dan tidak usah pakai log transaksi").
--   19 Nov 2026 (20261119000001): diganti lagi jadi ADJ beraudit — setiap
--     perubahan menulis baris ledger (IN/OUT). Itu memperbaiki ketertelusuran,
--     TAPI mencemari kolom IN/OUT (ADJ -6 membuat OUT jadi -12) dan membuat
--     Stok Akhir = angka input (mengabaikan IN/OUT) — persis yang dikeluhkan
--     Anggi (kasus Hardisk 4 TB, PSU, CPU Rakitan).
--
-- Perilaku baru (menggabungkan ketiganya):
--   1. Angka yang dimasukkan = Stok Awal BARU.
--   2. Stok Akhir bergerak mengikuti perubahan Stok Awal (naik/turun sama
--      besar): Stok Akhir baru = Stok Akhir lama + (Stok Awal baru - Stok
--      Awal lama). Bila baris sebelumnya sudah klop (Stok Awal + IN - OUT =
--      Stok Akhir), hasilnya sama persis dengan rumus Stok Awal + IN - OUT.
--      Bila baris sebelumnya ada selisih (menunggu hitung fisik), selisih
--      itu DIPERTAHANKAN — tidak dihapus diam-diam dengan menimpa Stok Akhir
--      dari kertas (Stok Akhir fisik tidak boleh ditimpa tanpa hitung).
--   3. Ledger TIDAK disentuh (tidak ada baris IN/OUT baru) — IN/OUT di
--      halaman Stok hanya berisi pergerakan barang nyata.
--   4. Perubahan TETAP terlacak: satu baris audit_logs (entity_type
--      'inventory_balances', Stok Awal + Stok Akhir lama/baru + pergerakan
--      bersih Log), terlihat di menu Audit Log. Tidak ada trigger audit
--      untuk inventory_balances, jadi tidak ada jejak ganda.
--   5. Simpan tanpa mengubah angka = tidak ada perubahan sama sekali
--      (tidak ada baris audit). Stok Akhir negatif ditolak dengan pesan jelas.

DROP FUNCTION IF EXISTS public.set_opening_stock(uuid, uuid, numeric);
CREATE FUNCTION public.set_opening_stock(p_item_id uuid, p_location_id uuid, p_qty numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_old_opening numeric(15,3);
  v_old_qty     numeric(15,3);
  v_net         numeric(15,3);
  v_new_qty     numeric(15,3);
  v_item_name   text;
  v_loc_code    text;
BEGIN
  IF NOT (
    public.has_permission('inventory.manage')
    OR public.has_permission('inventory.adjust')
    OR public.is_super_admin()
  ) THEN
    RAISE EXCEPTION 'Tidak punya izin mengatur stok awal';
  END IF;
  IF p_qty < 0 THEN
    RAISE EXCEPTION 'Stok awal tidak boleh negatif';
  END IF;

  -- Pastikan baris saldo ada, lalu kunci supaya hitungan memakai angka kini.
  INSERT INTO public.inventory_balances (item_id, location_id, qty)
  VALUES (p_item_id, p_location_id, 0)
  ON CONFLICT DO NOTHING;

  SELECT opening_qty, qty INTO v_old_opening, v_old_qty
    FROM public.inventory_balances
   WHERE item_id = p_item_id AND location_id = p_location_id
     FOR UPDATE;
  v_old_opening := COALESCE(v_old_opening, 0);
  v_old_qty := COALESCE(v_old_qty, 0);

  -- Tidak ada perubahan: diam saja (tanpa baris audit).
  IF p_qty = v_old_opening THEN
    RETURN;
  END IF;

  -- Pergerakan bersih dari Log (IN - OUT). Hanya untuk dicatat di jejak audit;
  -- ledger tidak diubah, dan Stok Akhir tidak dihitung ulang dari kertas
  -- (selisih lama, bila ada, dipertahankan sampai hitung fisik).
  SELECT COALESCE(SUM(qty_change), 0) INTO v_net
    FROM public.inventory_ledger
   WHERE item_id = p_item_id AND location_id = p_location_id;

  v_new_qty := v_old_qty + (p_qty - v_old_opening);
  IF v_new_qty < 0 THEN
    RAISE EXCEPTION 'Stok awal % terlalu kecil: stok akhir saat ini %, stok awal saat ini %, sehingga stok akhir jadi % (negatif)',
      p_qty, v_old_qty, v_old_opening, v_new_qty;
  END IF;

  UPDATE public.inventory_balances
     SET opening_qty = p_qty,
         qty = v_new_qty,
         updated_at = now()
   WHERE item_id = p_item_id AND location_id = p_location_id;

  -- Jejak audit di menu Audit Log (bukan Log Transaksi).
  SELECT name INTO v_item_name FROM public.inventory_items WHERE id = p_item_id;
  SELECT code INTO v_loc_code FROM public.locations WHERE id = p_location_id;
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, old_data, new_data)
  VALUES (auth.uid(), 'UPDATE', 'inventory_balances', p_item_id::text,
    jsonb_build_object(
      'item', COALESCE(v_item_name, p_item_id::text),
      'location_code', v_loc_code,
      'opening_qty', v_old_opening,
      'qty', v_old_qty,
      'net_ledger', v_net),
    jsonb_build_object(
      'item', COALESCE(v_item_name, p_item_id::text),
      'location_code', v_loc_code,
      'opening_qty', p_qty,
      'qty', v_new_qty,
      'net_ledger', v_net));
END;
$function$;

REVOKE ALL ON FUNCTION public.set_opening_stock(uuid, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_opening_stock(uuid, uuid, numeric) TO authenticated;
