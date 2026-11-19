-- Atur Stok beraudit: setiap perubahan lewat set_opening_stock kini tercatat
-- sebagai transaksi penyesuaian (ADJ-...) di Log Transaksi + baris ledger.
--
-- Masalah yang diperbaiki (19 Nov 2026): versi lama hanya melakukan upsert
-- langsung ke inventory_balances (qty + opening_qty) TANPA jejak apa pun.
-- Akibatnya saldo live bisa berubah diam-diam dan tidak bisa lagi dijelaskan
-- dari riwayat (kasus CPU Rakitan 11 Nov: saldo jatuh 17 -> 7 tanpa jejak,
-- selisih -9 vs hitungan kertas; 22 barang tidak cocok di audit 19 Nov).
--
-- Perilaku baru (semua dalam satu transaksi, atomik):
--   1. Baris saldo dikunci dulu (SELECT ... FOR UPDATE) supaya dua pemanggil
--      bersamaan tidak salah hitung delta.
--   2. Kalau ada selisih (target <> saldo lama): buat transaksi 'adjust'
--      status 'posted' (nomor ADJ-... diisi trigger set_doc_number),
--      satu baris item berisi delta (boleh negatif), lalu terapkan lewat
--      _apply_posted_effects — saldo berubah sebesar delta DAN satu baris
--      ledger ditulis dengan qty_after = angka baru.
--   3. opening_qty di-set ke angka baru (perilaku lama dipertahankan).
--   4. Kalau target = saldo lama (delta 0): tidak ada transaksi (qty 0
--      ditolak _apply_posted_effects), hanya opening_qty yang disetel.
-- Izin dan penolakan angka negatif tidak berubah dari versi lama.
-- NOTE: identitas opening + ledger = saldo live tetap TIDAK dijamin bila
-- opening ditulis ulang — yang dijamin adalah rantai qty_after ledger selalu
-- sama dengan saldo live (itulah yang dipakai semua tampilan & jawaban audit).

CREATE OR REPLACE FUNCTION public.set_opening_stock(p_item_id uuid, p_location_id uuid, p_qty numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_old         numeric(15,3);
  v_delta       numeric(15,3);
  v_txn_id      uuid;
  v_item_name   text;
  v_loc_code    text;
  v_status_aset text;
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

  -- Pastikan baris saldo ada, lalu kunci supaya delta dihitung dari angka kini.
  INSERT INTO public.inventory_balances (item_id, location_id, qty)
  VALUES (p_item_id, p_location_id, 0)
  ON CONFLICT DO NOTHING;

  SELECT qty INTO v_old
    FROM public.inventory_balances
   WHERE item_id = p_item_id AND location_id = p_location_id
     FOR UPDATE;
  v_old := COALESCE(v_old, 0);
  v_delta := p_qty - v_old;

  -- Nama barang + kode lokasi, supaya jejak di Log bisa dibaca manusia.
  SELECT name INTO v_item_name FROM public.inventory_items WHERE id = p_item_id;
  SELECT code INTO v_loc_code FROM public.locations WHERE id = p_location_id;
  v_status_aset := CASE
    WHEN v_loc_code ILIKE '%RETUR%' THEN 'ASSET RETUR'
    WHEN v_loc_code ILIKE '%UNREADY%' THEN 'UNREADY'
    ELSE 'ASSET BARU'
  END;

  IF v_delta <> 0 THEN
    INSERT INTO public.inventory_transactions
      (type, status, transaction_date, source_location_id, dest_location_id,
       reference, notes, created_by)
    VALUES
      ('adjust', 'posted', CURRENT_DATE, p_location_id, p_location_id,
       'ATUR-STOK',
       format('Atur Stok: %s (%s) %s -> %s',
              COALESCE(v_item_name, p_item_id::text),
              COALESCE(v_loc_code, '-'), v_old, p_qty),
       auth.uid())
    RETURNING id INTO v_txn_id;

    INSERT INTO public.inventory_transaction_items
      (transaction_id, item_id, qty, status_aset, notes)
    VALUES
      (v_txn_id, p_item_id, v_delta, v_status_aset,
       format('Atur Stok: %s -> %s', v_old, p_qty));

    -- Ubah saldo sebesar delta + tulis baris ledger (qty_after = angka baru).
    -- Hasil akhir p_qty >= 0 sudah dijamin validasi di atas, jadi tanpa
    -- allow_negative pun aman.
    PERFORM public._apply_posted_effects(v_txn_id, false);
  END IF;

  -- Stok Awal mengikuti angka baru (perilaku lama dipertahankan).
  UPDATE public.inventory_balances
     SET opening_qty = p_qty,
         updated_at = now()
   WHERE item_id = p_item_id AND location_id = p_location_id;
END;
$function$;
