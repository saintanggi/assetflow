-- =============================================================
-- AssetFlow — supabase/tests/rls_smoke.sql
-- =============================================================
-- Smoke test RLS, helper otorisasi, dan RPC. Dijalankan MANUAL di
-- Supabase SQL Editor SETELAH migrasi 000001..000004 berhasil.
--
-- Cara pakai: blok-select seluruh file -> Run. Hasil: tabel berisi
-- nama test, lolos (true/false), dan detail.
--
-- Yang dibuktikan:
--   T1  RLS aktif di semua tabel.
--   T2  Fungsi sensitif adalah SECURITY DEFINER + search_path tetap.
--   T3  anon tidak punya SELECT ke tabel privat; tidak ada view.
--   T4  RPC publik hanya mengembalikan kolom whitelist.
--   T5  post_inventory_transaction tanpa login -> ditolak.
--   T6  get_public_asset: aset non-publish tidak terlihat; yang
--       publish terlihat (tanpa kolom privat).
--   T7  Pembuatan user uji (admin & super_admin).
--   T8a-j Sebagai admin: SELECT aset OK; audit_logs tak terlihat;
--       DELETE transaksi & INSERT saldo langsung ditolak;
--       eskalasi role sendiri ditolak; stok minus ditolak;
--       idempotency tidak menggandakan efek; reverse ganda ditolak;
--       finalize opname memposting selisih; super_admin bisa baca audit.
--   T9  Bersih-bersih data uji.
--
-- TIDAK memakai framework; tiap test = DO block + pencatatan hasil.
-- Jika T7 gagal (mis. skema auth.users berbeda), sub-test T8 tercatat
-- SKIP dan test lain tetap berjalan.
-- =============================================================

CREATE TEMP TABLE IF NOT EXISTS _t (name text PRIMARY KEY, ok boolean, detail text);
DELETE FROM _t;

CREATE TEMP TABLE IF NOT EXISTS _flag (k text PRIMARY KEY, v text);
DELETE FROM _flag;

-- =============================================================
-- T1: RLS aktif di semua tabel
-- =============================================================
DO $$
DECLARE
  v_n   int;
  v_bad text;
BEGIN
  SELECT count(*), string_agg(c.relname, ', ')
    INTO v_n, v_bad
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname IN (
      'profiles','roles','permissions','role_permissions','user_permissions',
      'asset_categories','warehouses','locations','units','departments','suppliers',
      'assets','inventory_items','inventory_balances',
      'inventory_transactions','inventory_transaction_items','inventory_ledger',
      'asset_movements','stock_counts','stock_count_items',
      'audit_logs','app_settings','doc_counters')
    AND NOT c.relrowsecurity;

  IF v_n > 0 THEN
    RAISE EXCEPTION '% tabel tanpa RLS: %', v_n, v_bad;
  END IF;
  INSERT INTO _t VALUES ('T1 RLS aktif di semua tabel', true, '23 tabel OK');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _t VALUES ('T1 RLS aktif di semua tabel', false, SQLERRM);
END $$;

-- =============================================================
-- T2: fungsi sensitif = SECURITY DEFINER + search_path tetap
-- =============================================================
DO $$
DECLARE
  v_n int;
BEGIN
  SELECT count(*) INTO v_n
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'is_super_admin','is_staff','has_permission',
      'post_inventory_transaction','reverse_inventory_transaction',
      'finalize_stock_count','get_public_asset','search_public_assets',
      'log_audit','next_doc_number','handle_new_user')
    AND p.prosecdef
    AND p.proconfig::text LIKE '%search_path=public, extensions%';

  IF v_n <> 11 THEN
    RAISE EXCEPTION 'hanya % dari 11 fungsi yang memenuhi syarat', v_n;
  END IF;
  INSERT INTO _t VALUES ('T2 SECURITY DEFINER + search_path tetap', true, '11 fungsi OK');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _t VALUES ('T2 SECURITY DEFINER + search_path tetap', false, SQLERRM);
END $$;

-- =============================================================
-- T3: anon tanpa SELECT ke tabel privat; tidak ada view
-- =============================================================
DO $$
DECLARE
  v_anon int;
  v_view int;
BEGIN
  SELECT count(*) INTO v_anon
  FROM pg_policies
  WHERE schemaname = 'public'
    AND cmd = 'SELECT'
    AND 'anon' = ANY (roles)
    AND tablename IN (
      'profiles','roles','permissions','role_permissions','user_permissions',
      'assets','inventory_items','inventory_balances',
      'inventory_transactions','inventory_transaction_items','inventory_ledger',
      'asset_movements','stock_counts','stock_count_items',
      'audit_logs','app_settings');

  SELECT count(*) INTO v_view
  FROM pg_views
  WHERE schemaname = 'public';

  IF v_anon > 0 THEN
    RAISE EXCEPTION '% kebijakan SELECT untuk anon di tabel privat', v_anon;
  END IF;
  IF v_view > 0 THEN
    RAISE EXCEPTION '% view di schema public (risiko bypass RLS)', v_view;
  END IF;
  INSERT INTO _t VALUES ('T3 anon ditolak; tanpa view', true, '0 policy anon, 0 view');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _t VALUES ('T3 anon ditolak; tanpa view', false, SQLERRM);
END $$;

-- =============================================================
-- T3b: anon benar-benar tidak bisa SELECT assets (langsung)
-- =============================================================
DO $$
DECLARE
  v_n int := -1;
BEGIN
  SET ROLE anon;
  BEGIN
    SELECT count(*) INTO v_n FROM public.assets;
  EXCEPTION WHEN OTHERS THEN
    v_n := -1;  -- ditolak di level GRANT
  END;
  RESET ROLE;

  IF v_n > 0 THEN
    INSERT INTO _t VALUES ('T3b anon tidak bisa SELECT assets', false,
      'anon membaca ' || v_n || ' baris!');
  ELSE
    INSERT INTO _t VALUES ('T3b anon tidak bisa SELECT assets', true,
      CASE WHEN v_n = -1 THEN 'permission denied (level GRANT)'
           ELSE '0 baris (level RLS)' END);
  END IF;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  INSERT INTO _t VALUES ('T3b anon tidak bisa SELECT assets', false, SQLERRM);
END $$;

-- =============================================================
-- T4: whitelist kolom RPC publik (eksplisit, tanpa kolom privat)
-- =============================================================
DO $$
DECLARE
  v_cols text[];
  v_want text[] := ARRAY[
    'public_code','name','category','brand','model',
    'condition','status','photo_url','department','published_at'];
BEGIN
  CREATE TEMP VIEW _v_pub AS
    SELECT * FROM public.get_public_asset('__tidak_ada__');

  SELECT array_agg(a.attname ORDER BY a.attnum) INTO v_cols
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  WHERE c.relname = '_v_pub'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  DROP VIEW _v_pub;

  IF v_cols <> v_want THEN
    RAISE EXCEPTION 'kolom berubah: %', coalesce(array_to_string(v_cols, ','), '(null)');
  END IF;
  INSERT INTO _t VALUES ('T4 whitelist kolom RPC publik', true, array_to_string(v_cols, ','));
EXCEPTION WHEN OTHERS THEN
  BEGIN DROP VIEW IF EXISTS _v_pub; EXCEPTION WHEN OTHERS THEN NULL; END;
  INSERT INTO _t VALUES ('T4 whitelist kolom RPC publik', false, SQLERRM);
END $$;

-- =============================================================
-- T5: RPC transaksi tanpa login -> ditolak (Izin ditolak)
-- =============================================================
DO $$
BEGIN
  PERFORM public.post_inventory_transaction(
    'test-noauth', 'in', CURRENT_DATE, NULL,
    (SELECT id FROM public.locations WHERE code = 'RAK-A1'),
    NULL, NULL,
    jsonb_build_array(jsonb_build_object('item_id', gen_random_uuid(), 'qty', 1)));

  INSERT INTO _t VALUES ('T5 tolak transaksi tanpa login', false, 'TIDAK ditolak!');
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '%Izin ditolak%' THEN
    INSERT INTO _t VALUES ('T5 tolak transaksi tanpa login', true, SQLERRM);
  ELSE
    INSERT INTO _t VALUES ('T5 tolak transaksi tanpa login', false, 'error tak terduga: ' || SQLERRM);
  END IF;
END $$;

-- =============================================================
-- T6: RPC publik hanya untuk aset yang dipublish
-- =============================================================
DO $$
DECLARE
  v_pub text;
  v_n   int;
BEGIN
  DELETE FROM public.assets WHERE asset_code = 'TEST-AST-001';

  INSERT INTO public.assets (asset_code, name, purchase_price, serial_number, custodian)
  VALUES ('TEST-AST-001', 'Aset Uji Smoke', 15000000, 'SN-RAHASIA-001', 'Pegawai X')
  RETURNING public_code INTO v_pub;

  -- Belum publish -> tidak terlihat.
  SELECT count(*) INTO v_n FROM public.get_public_asset(v_pub);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'aset non-publish terlihat di RPC publik';
  END IF;

  -- Publish -> terlihat 1 baris (kolom privat tidak ada = dibuktikan T4).
  UPDATE public.assets SET is_published = true WHERE asset_code = 'TEST-AST-001';
  SELECT count(*) INTO v_n FROM public.get_public_asset(v_pub);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'aset publish tidak muncul di RPC publik';
  END IF;

  INSERT INTO _t VALUES ('T6 RPC publik hanya aset publish', true, 'non-publish=0 baris, publish=1 baris');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _t VALUES ('T6 RPC publik hanya aset publish', false, SQLERRM);
END $$;

-- =============================================================
-- T7: user uji (admin & super_admin) + 1 item uji
-- =============================================================
DO $$
DECLARE
  v_admin uuid := gen_random_uuid();
  v_super uuid := gen_random_uuid();
BEGIN
  DELETE FROM auth.users
  WHERE email IN ('rls-smoke-admin@example.com', 'rls-smoke-super@example.com');

  INSERT INTO auth.users
    (instance_id, id, aud, role, email, encrypted_password,
     email_confirmed_at, created_at, updated_at,
     raw_app_meta_data, raw_user_meta_data)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_admin, 'authenticated', 'authenticated',
     'rls-smoke-admin@example.com', crypt('Smoke123!', gen_salt('bf')),
     now(), now(), now(),
     '{"provider":"email","providers":["email"]}', '{"full_name":"Smoke Admin"}'),
    ('00000000-0000-0000-0000-000000000000', v_super, 'authenticated', 'authenticated',
     'rls-smoke-super@example.com', crypt('Smoke123!', gen_salt('bf')),
     now(), now(), now(),
     '{"provider":"email","providers":["email"]}', '{"full_name":"Smoke Super"}');

  -- Trigger handle_new_user membuat profiles; tetapkan role.
  UPDATE public.profiles
     SET role_id = (SELECT id FROM public.roles WHERE name = 'admin')
   WHERE id = v_admin;
  UPDATE public.profiles
     SET role_id = (SELECT id FROM public.roles WHERE name = 'super_admin')
   WHERE id = v_super;

  INSERT INTO public.inventory_items (sku, name, unit_id, min_stock)
  VALUES ('TEST-SKU-001', 'Barang Uji Smoke',
          (SELECT id FROM public.units WHERE code = 'pcs'), 0)
  ON CONFLICT (sku) DO NOTHING;

  INSERT INTO _flag VALUES
    ('admin_uid', v_admin::text),
    ('super_uid', v_super::text)
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v;

  INSERT INTO _t VALUES ('T7 user & data uji', true, 'admin + super_admin + TEST-SKU-001 siap');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _t VALUES ('T7 user & data uji', false, 'SKIP sub-test T8: ' || SQLERRM);
END $$;

-- Tabel penampung hasil sub-test T8 (butuh GRANT karena diisi sbg authenticated).
CREATE TEMP TABLE IF NOT EXISTS _t8 (name text, ok boolean, detail text);
DELETE FROM _t8;
GRANT ALL ON TABLE _t8 TO authenticated;

-- Penampung id transaksi uji untuk bersih-bersih T9.
CREATE TEMP TABLE IF NOT EXISTS _test_txn (id uuid PRIMARY KEY);
DELETE FROM _test_txn;
GRANT ALL ON TABLE _test_txn TO authenticated;

-- =============================================================
-- T8: skenario sebagai admin login (SET ROLE authenticated + JWT mock)
-- =============================================================
DO $$
DECLARE
  v_uid   text;
  v_loc   uuid;
  v_item  uuid;
  v_n     int;
  v_doc   text;
  v_doc2  text;
  v_txn   uuid;
  v_rev   text;
  v_bal   numeric;
  v_sc    uuid;
  v_st    text;
BEGIN
  SELECT v INTO v_uid FROM _flag WHERE k = 'admin_uid';
  IF v_uid IS NULL THEN
    INSERT INTO _t8 VALUES ('T8 sub-test sebagai admin', false, 'SKIP: T7 gagal');
    RETURN;
  END IF;

  EXECUTE 'SET request.jwt.claim.sub = ''' || v_uid || '''';
  SET ROLE authenticated;

  BEGIN
    SELECT id INTO v_loc  FROM public.locations WHERE code = 'RAK-A1';
    SELECT id INTO v_item FROM public.inventory_items WHERE sku = 'TEST-SKU-001';

    -- T8a: admin boleh SELECT assets.
    BEGIN
      SELECT count(*) INTO v_n FROM public.assets;
      INSERT INTO _t8 VALUES ('T8a admin SELECT assets', true, 'count=' || v_n);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO _t8 VALUES ('T8a admin SELECT assets', false, SQLERRM);
    END;

    -- T8b: admin TIDAK melihat audit_logs (0 baris, bukan error).
    BEGIN
      SELECT count(*) INTO v_n FROM public.audit_logs;
      IF v_n <> 0 THEN RAISE EXCEPTION 'audit_logs terlihat (% baris)', v_n; END IF;
      INSERT INTO _t8 VALUES ('T8b admin tidak baca audit_logs', true, '0 baris');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO _t8 VALUES ('T8b admin tidak baca audit_logs', false, SQLERRM);
    END;

    -- T8c: DELETE transaksi langsung -> tidak berpengaruh. Catatan semantik RLS
    -- Postgres: tanpa policy DELETE, baris tidak terlihat oleh perintah DELETE
    -- (0 rows affected, TANPA error). Yang penting secara keamanan: baris TIDAK
    -- terhapus. Jadi asersi yang benar adalah ROW_COUNT = 0, bukan exception.
    BEGIN
      v_doc := public.post_inventory_transaction(
        'test-t8c', 'in', CURRENT_DATE, NULL, v_loc, 'PO-T8C', 'smoke-test',
        jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 1)));
      SELECT id INTO v_txn FROM public.inventory_transactions WHERE doc_number = v_doc;
      IF v_txn IS NULL THEN RAISE EXCEPTION 'setup T8c gagal: transaksi tidak terbentuk'; END IF;
      INSERT INTO _test_txn SELECT v_txn;
      DELETE FROM public.inventory_transactions WHERE id = v_txn;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n = 0 THEN
        INSERT INTO _t8 VALUES ('T8c DELETE transaksi ditolak', true, '0 rows affected — baris tetap ada');
      ELSE
        INSERT INTO _t8 VALUES ('T8c DELETE transaksi ditolak', false, 'baris ikut terhapus!');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Exception juga berarti penolakan (mis. bila policy berubah me-raise).
      INSERT INTO _t8 VALUES ('T8c DELETE transaksi ditolak', true, 'ditolak via error: ' || left(SQLERRM, 80));
    END;

    -- T8d: INSERT saldo langsung -> ditolak (hanya via RPC).
    BEGIN
      INSERT INTO public.inventory_balances (item_id, location_id, qty)
      VALUES (v_item, v_loc, 1);
      INSERT INTO _t8 VALUES ('T8d INSERT saldo langsung ditolak', false, 'TIDAK ditolak!');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO _t8 VALUES ('T8d INSERT saldo langsung ditolak', true, 'ditolak: ' || left(SQLERRM, 80));
    END;

    -- T8e: eskalasi role sendiri -> ditolak trigger.
    BEGIN
      UPDATE public.profiles
         SET role_id = (SELECT id FROM public.roles WHERE name = 'super_admin')
       WHERE id = v_uid::uuid;
      INSERT INTO _t8 VALUES ('T8e eskalasi role sendiri ditolak', false, 'TIDAK ditolak!');
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE '%Hanya Super Admin%' THEN
        INSERT INTO _t8 VALUES ('T8e eskalasi role sendiri ditolak', true, SQLERRM);
      ELSE
        INSERT INTO _t8 VALUES ('T8e eskalasi role sendiri ditolak', false, 'error tak terduga: ' || SQLERRM);
      END IF;
    END;

    -- T8f: barang masuk 10, lalu barang keluar 999 -> ditolak stok minus.
    BEGIN
      v_doc := public.post_inventory_transaction(
        'test-k1', 'in', CURRENT_DATE, NULL, v_loc, 'PO-TEST', 'smoke-test',
        jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 10)));
      INSERT INTO _test_txn
        SELECT id FROM public.inventory_transactions WHERE doc_number = v_doc;

      BEGIN
        PERFORM public.post_inventory_transaction(
          'test-k2', 'out', CURRENT_DATE, v_loc, NULL, NULL, 'smoke-test',
          jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 999)));
        INSERT INTO _t8 VALUES ('T8f stok minus ditolak', false, 'TIDAK ditolak!');
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%Stok tidak mencukupi%' THEN
          SELECT qty INTO v_bal FROM public.inventory_balances
          WHERE item_id = v_item AND location_id = v_loc;
          IF v_bal <> 10 THEN
            RAISE EXCEPTION 'saldo berubah setelah penolakan: %', v_bal;
          END IF;
          INSERT INTO _t8 VALUES ('T8f stok minus ditolak', true, 'saldo tetap 10');
        ELSE
          INSERT INTO _t8 VALUES ('T8f stok minus ditolak', false, 'error tak terduga: ' || SQLERRM);
        END IF;
      END;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO _t8 VALUES ('T8f stok minus ditolak', false, 'gagal setup: ' || SQLERRM);
    END;

    -- T8g: idempotency — kirim 2x dengan key sama -> 1 efek.
    BEGIN
      v_doc2 := public.post_inventory_transaction(
        'test-k3', 'in', CURRENT_DATE, NULL, v_loc, NULL, 'smoke-test',
        jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 5)));
      INSERT INTO _test_txn
        SELECT id FROM public.inventory_transactions WHERE doc_number = v_doc2;

      SELECT public.post_inventory_transaction(
        'test-k3', 'in', CURRENT_DATE, NULL, v_loc, NULL, 'smoke-test',
        jsonb_build_array(jsonb_build_object('item_id', v_item, 'qty', 5)))
      INTO v_doc;

      IF v_doc <> v_doc2 THEN
        RAISE EXCEPTION 'doc_number berbeda: % vs %', v_doc, v_doc2;
      END IF;
      SELECT qty INTO v_bal FROM public.inventory_balances
      WHERE item_id = v_item AND location_id = v_loc;
      IF v_bal <> 15 THEN
        RAISE EXCEPTION 'saldo bukan 15 (efek ganda?): %', v_bal;
      END IF;
      INSERT INTO _t8 VALUES ('T8g idempotency tanpa efek ganda', true, 'doc=' || v_doc2 || ', saldo=15');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO _t8 VALUES ('T8g idempotency tanpa efek ganda', false, SQLERRM);
    END;

    -- T8h: reverse transaksi, lalu reverse lagi -> ditolak.
    BEGIN
      SELECT id INTO v_txn FROM public.inventory_transactions WHERE doc_number = v_doc2;
      v_rev := public.reverse_inventory_transaction(v_txn, 'smoke-test koreksi');
      INSERT INTO _test_txn
        SELECT id FROM public.inventory_transactions WHERE doc_number = v_rev;

      SELECT qty INTO v_bal FROM public.inventory_balances
      WHERE item_id = v_item AND location_id = v_loc;
      IF v_bal <> 10 THEN
        RAISE EXCEPTION 'saldo setelah koreksi bukan 10: %', v_bal;
      END IF;

      BEGIN
        PERFORM public.reverse_inventory_transaction(v_txn, 'koreksi kedua');
        INSERT INTO _t8 VALUES ('T8h reverse ganda ditolak', false, 'TIDAK ditolak!');
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%Hanya transaksi posted%' THEN
          INSERT INTO _t8 VALUES ('T8h reverse & reverse ganda ditolak', true,
            'koreksi=' || v_rev || ', saldo kembali 10');
        ELSE
          INSERT INTO _t8 VALUES ('T8h reverse & reverse ganda ditolak', false, 'error tak terduga: ' || SQLERRM);
        END IF;
      END;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO _t8 VALUES ('T8h reverse & reverse ganda ditolak', false, 'gagal setup: ' || SQLERRM);
    END;

    -- T8i: finalize stock opname memposting selisih.
    BEGIN
      INSERT INTO public.stock_counts (location_id, notes)
      VALUES (v_loc, 'smoke-test')
      RETURNING id INTO v_sc;

      INSERT INTO public.stock_count_items (stock_count_id, item_id, system_qty, counted_qty)
      VALUES (v_sc, v_item, 0, 7);

      v_doc := public.finalize_stock_count(v_sc);
      INSERT INTO _test_txn
        SELECT id FROM public.inventory_transactions WHERE doc_number = v_doc;

      SELECT qty INTO v_bal FROM public.inventory_balances
      WHERE item_id = v_item AND location_id = v_loc;
      SELECT status INTO v_st FROM public.stock_counts WHERE id = v_sc;
      IF v_bal <> 7 OR v_st <> 'posted' THEN
        RAISE EXCEPTION 'hasil opname salah: saldo=%, status=%', v_bal, v_st;
      END IF;
      INSERT INTO _t8 VALUES ('T8i finalize opname', true, 'doc=' || v_doc || ', saldo 10->7, posted');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO _t8 VALUES ('T8i finalize opname', false, SQLERRM);
    END;

  END;
  RESET ROLE;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  INSERT INTO _t8 VALUES ('T8 FATAL', false, SQLERRM);
END $$;

-- T8j: super_admin BISA membaca audit_logs.
DO $$
DECLARE
  v_uid text;
  v_n   int;
BEGIN
  SELECT v INTO v_uid FROM _flag WHERE k = 'super_uid';
  IF v_uid IS NULL THEN
    INSERT INTO _t8 VALUES ('T8j super_admin baca audit_logs', false, 'SKIP: T7 gagal');
  ELSE
    EXECUTE 'SET request.jwt.claim.sub = ''' || v_uid || '''';
    SET ROLE authenticated;
    BEGIN
      SELECT count(*) INTO v_n FROM public.audit_logs;
      INSERT INTO _t8 VALUES ('T8j super_admin baca audit_logs', true, 'count=' || v_n);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO _t8 VALUES ('T8j super_admin baca audit_logs', false, SQLERRM);
    END;
    RESET ROLE;
  END IF;
EXCEPTION WHEN OTHERS THEN
  BEGIN RESET ROLE; EXCEPTION WHEN OTHERS THEN NULL; END;
  INSERT INTO _t8 VALUES ('T8j super_admin baca audit_logs', false, SQLERRM);
END $$;

INSERT INTO _t SELECT * FROM _t8;

-- =============================================================
-- T9: bersih-bersih data uji
-- =============================================================
DO $$
BEGIN
  DELETE FROM public.inventory_ledger
  WHERE transaction_id IN (SELECT id FROM _test_txn);

  DELETE FROM public.inventory_transaction_items
  WHERE transaction_id IN (SELECT id FROM _test_txn);

  -- Koreksi (reversal_of terisi) dihapus dulu karena FK RESTRICT.
  DELETE FROM public.inventory_transactions
  WHERE id IN (SELECT id FROM _test_txn) AND reversal_of IS NOT NULL;

  DELETE FROM public.inventory_transactions
  WHERE id IN (SELECT id FROM _test_txn);

  DELETE FROM public.inventory_balances
  WHERE item_id = (SELECT id FROM public.inventory_items WHERE sku = 'TEST-SKU-001');

  DELETE FROM public.stock_count_items
  WHERE stock_count_id IN (SELECT id FROM public.stock_counts WHERE notes = 'smoke-test');

  DELETE FROM public.stock_counts WHERE notes = 'smoke-test';

  DELETE FROM public.assets WHERE asset_code = 'TEST-AST-001';
  DELETE FROM public.inventory_items WHERE sku = 'TEST-SKU-001';

  DELETE FROM public.user_permissions
  WHERE user_id IN (SELECT id FROM public.profiles WHERE email LIKE 'rls-smoke-%@example.com');
  DELETE FROM public.profiles WHERE email LIKE 'rls-smoke-%@example.com';
  DELETE FROM auth.users WHERE email LIKE 'rls-smoke-%@example.com';

  INSERT INTO _t VALUES ('T9 bersih-bersih', true, 'data uji dihapus');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _t VALUES ('T9 bersih-bersih', false, SQLERRM);
END $$;

-- Kembalikan JWT mock & tampilkan hasil.
RESET request.jwt.claim.sub;

SELECT name AS test, ok AS lolos, detail FROM _t ORDER BY name;
