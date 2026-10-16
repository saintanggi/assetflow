-- ===============================================================================
-- FIX BUG: Barang Masuk gagal "Stok tidak mencukupi" padahal stok ditambah
-- ===============================================================================
-- Cara pakai:
--   1. Buka https://supabase.com/dashboard -> pilih project kamu
--   2. Menu kiri: SQL Editor -> New query
--   3. Copas SELURUH isi file ini -> klik RUN
--   4. Harus muncul "Success. No rows returned"
--
-- Isi file ini = 1 migrasi repo:
--   supabase/migrations/20261016000031_fix_inbound_negative_guard.sql
-- Aman dijalankan berulang kali (idempoten), tidak mengubah data.
-- ===============================================================================

-- 20261016000031 — Perbaiki guard "Stok tidak mencukupi" pada _change_balance.
--
-- BUG: Barang Masuk (delta positif) gagal dengan error "Stok tidak mencukupi"
-- ketika saldo lokasi sedang NEGATIF (mis. tersedia -8.000, perubahan +1.000).
-- Saldo negatif bisa terjadi dari upload/sinkronisasi sheet yang memang
-- diizinkan membuat stok minus (migrasi 20261013000014).
--
-- Penyebab: guard `v_qty + p_delta < 0` dijalankan untuk SEMUA arah perubahan.
-- Untuk barang masuk (+1 pada saldo -8), hasilnya -7 < 0 sehingga DITOLAK —
-- padahal barang masuk fisik tidak mungkin "kekurangan stok". Efek samping
-- yang lebih parah: saldo negatif jadi TIDAK BISA diperbaiki lewat
-- Barang Masuk (hanya input >= 8 sekaligus yang lolos).
--
-- Perbaikan: guard hanya berlaku untuk PENGURANGAN stok (p_delta < 0).
--   - Barang Masuk / kaki positif transfer / adjust positif : selalu lolos.
--   - Barang Keluar / kaki negatif transfer / adjust negatif : tetap ditolak
--     jika membuat saldo negatif (kecuali p_allow_negative = true).
--
-- Aman dijalankan berulang (CREATE OR REPLACE), tidak mengubah data.

CREATE OR REPLACE FUNCTION public._change_balance(
  p_item_id        uuid,
  p_location_id    uuid,
  p_delta          numeric,
  p_transaction_id uuid,
  p_allow_negative boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_qty numeric(15,3);
BEGIN
  IF p_location_id IS NULL THEN
    RAISE EXCEPTION 'Lokasi wajib diisi untuk perubahan stok';
  END IF;
  IF p_delta = 0 THEN
    RAISE EXCEPTION 'Perubahan stok tidak boleh nol';
  END IF;

  INSERT INTO public.inventory_balances (item_id, location_id, qty)
  VALUES (p_item_id, p_location_id, 0)
  ON CONFLICT DO NOTHING;

  SELECT qty INTO v_qty
  FROM public.inventory_balances
  WHERE item_id = p_item_id AND location_id = p_location_id
  FOR UPDATE;

  -- Hanya pengurangan stok yang bisa "tidak mencukupi".
  -- Penambahan stok (barang masuk) tidak pernah ditolak guard ini.
  IF NOT p_allow_negative AND p_delta < 0 AND v_qty + p_delta < 0 THEN
    RAISE EXCEPTION
      'Stok tidak mencukupi (item %, lokasi %): tersedia %, perubahan %',
      p_item_id, p_location_id, v_qty, p_delta;
  END IF;

  UPDATE public.inventory_balances
     SET qty = v_qty + p_delta
   WHERE item_id = p_item_id AND location_id = p_location_id;

  INSERT INTO public.inventory_ledger
    (transaction_id, item_id, location_id, qty_change, qty_after)
  VALUES (p_transaction_id, p_item_id, p_location_id, p_delta, v_qty + p_delta);
END;
$$;
REVOKE ALL ON FUNCTION public._change_balance(uuid, uuid, numeric, uuid, boolean) FROM PUBLIC;
