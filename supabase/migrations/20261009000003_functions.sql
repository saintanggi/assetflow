-- =============================================================
-- AssetFlow — Migrasi 000003: Fungsi RPC, trigger bisnis, audit
-- =============================================================
-- Semua fungsi SECURITY DEFINER memakai SET search_path = public, extensions
-- (tetap, anti pembajakan search_path). Fungsi internal (awalan _)
-- dicabut hak EXECUTE-nya dari PUBLIC: hanya bisa dipanggil dari
-- fungsi lain (yang berjalan sebagai owner).
--
-- Daftar fungsi & GRANT EXECUTE (didefinisikan inline per fungsi di bawah):
--   Publik untuk authenticated: post_inventory_transaction,
--     reverse_inventory_transaction, finalize_stock_count,
--     is_super_admin, is_staff, has_permission (tiga terakhir dari 000002)
--   Publik untuk anon + authenticated: get_public_asset, search_public_assets
--   Internal (REVOKE dari PUBLIC): _txn_required_permission, _change_balance,
--     _apply_posted_effects, next_doc_number, set_doc_number, log_audit,
--     handle_new_user, guard_*, *_before_insert, assets_before_write, dst.
-- =============================================================

-- =============================================================
-- 1. Trigger: profil otomatis saat user Auth baru mendaftar
--    role_id = NULL -> tanpa permission sampai ditetapkan Super Admin.
-- =============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, is_active)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''), NEW.email),
    true
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================================
-- 2. Penomoran dokumen anti-race (counter per prefix+tahun)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.doc_counters (
  prefix      text        NOT NULL,
  year        integer     NOT NULL,
  last_number integer     NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT doc_counters_pkey PRIMARY KEY (prefix, year)
);
ALTER TABLE public.doc_counters ENABLE ROW LEVEL SECURITY;
-- Tanpa policy: hanya owner & fungsi SECURITY DEFINER yang bisa akses.
DROP TRIGGER IF EXISTS trg_doc_counters_updated_at ON public.doc_counters;
CREATE TRIGGER trg_doc_counters_updated_at
  BEFORE UPDATE ON public.doc_counters
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Format: PREFIX-YYYY-NNNNNN  (cth IN-2026-000001)
CREATE OR REPLACE FUNCTION public.next_doc_number(p_prefix text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_year int := EXTRACT(YEAR FROM now())::int;
  v_n    int;
BEGIN
  IF p_prefix IS NULL OR btrim(p_prefix) = '' THEN
    RAISE EXCEPTION 'Prefix nomor dokumen wajib diisi';
  END IF;

  INSERT INTO public.doc_counters (prefix, year, last_number)
  VALUES (p_prefix, v_year, 0)
  ON CONFLICT DO NOTHING;

  -- UPDATE mengunci baris -> aman dari race condition.
  UPDATE public.doc_counters
     SET last_number = last_number + 1
   WHERE prefix = p_prefix AND year = v_year
  RETURNING last_number INTO v_n;

  RETURN p_prefix || '-' || v_year::text || '-' || lpad(v_n::text, 6, '0');
END;
$$;
REVOKE ALL ON FUNCTION public.next_doc_number(text) FROM PUBLIC;

-- Isi doc_number otomatis bila NULL (untuk insert langsung di luar RPC).
CREATE OR REPLACE FUNCTION public.set_doc_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.doc_number IS NULL OR btrim(NEW.doc_number) = '' THEN
    IF TG_TABLE_NAME = 'stock_counts' THEN
      NEW.doc_number := public.next_doc_number('SO');
    ELSE
      NEW.doc_number := public.next_doc_number(
        CASE NEW.type
          WHEN 'in'       THEN 'IN'
          WHEN 'out'      THEN 'OUT'
          WHEN 'transfer'  THEN 'TRF'
          WHEN 'adjust'    THEN 'ADJ'
          WHEN 'opname'    THEN 'OPN'
          WHEN 'return'    THEN 'RTN'
          ELSE 'TXN'
        END);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.set_doc_number() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_txn_doc_number ON public.inventory_transactions;
CREATE TRIGGER trg_txn_doc_number
  BEFORE INSERT ON public.inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_doc_number();

DROP TRIGGER IF EXISTS trg_count_doc_number ON public.stock_counts;
CREATE TRIGGER trg_count_doc_number
  BEFORE INSERT ON public.stock_counts
  FOR EACH ROW EXECUTE FUNCTION public.set_doc_number();

-- counted_by default = user yang membuat opname.
CREATE OR REPLACE FUNCTION public.stock_counts_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.counted_by IS NULL THEN
    NEW.counted_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.stock_counts_before_insert() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_stock_counts_bi ON public.stock_counts;
CREATE TRIGGER trg_stock_counts_bi
  BEFORE INSERT ON public.stock_counts
  FOR EACH ROW EXECUTE FUNCTION public.stock_counts_before_insert();

-- =============================================================
-- 3. Default & guard untuk assets
--    - public_code otomatis (untuk QR) bila NULL
--    - created_by default = pembuat
--    - publikasi butuh permission assets.publish
--    - arsip (archived=true) butuh permission assets.archive
-- =============================================================
CREATE OR REPLACE FUNCTION public.assets_before_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- Default saat INSERT.
  IF TG_OP = 'INSERT' THEN
    IF NEW.public_code IS NULL OR btrim(NEW.public_code) = '' THEN
      LOOP
        NEW.public_code :=
          'PUB-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
        EXIT WHEN NOT EXISTS (
          SELECT 1 FROM public.assets a WHERE a.public_code = NEW.public_code
        );
      END LOOP;
    END IF;
    IF NEW.created_by IS NULL THEN
      NEW.created_by := auth.uid();
    END IF;
    IF NEW.is_published THEN
      IF NOT (public.has_permission('assets.publish') OR auth.uid() IS NULL) THEN
        RAISE EXCEPTION 'Publikasi aset membutuhkan permission assets.publish';
      END IF;
      NEW.published_at := COALESCE(NEW.published_at, now());
      NEW.published_by := COALESCE(NEW.published_by, auth.uid());
    END IF;
    IF NEW.archived
       AND NOT (public.has_permission('assets.archive') OR auth.uid() IS NULL) THEN
      RAISE EXCEPTION 'Pengarsipan aset membutuhkan permission assets.archive';
    END IF;
  END IF;

  -- Guard saat UPDATE.
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.is_published IS DISTINCT FROM OLD.is_published
        OR NEW.published_at IS DISTINCT FROM OLD.published_at
        OR NEW.published_by IS DISTINCT FROM OLD.published_by)
       AND NOT (public.has_permission('assets.publish') OR auth.uid() IS NULL) THEN
      RAISE EXCEPTION 'Perubahan status publikasi aset membutuhkan permission assets.publish';
    END IF;
    -- published_at/by diisi otomatis saat pertama dipublikasikan,
    -- dibersihkan saat publikasi dicabut.
    IF NEW.is_published AND NOT OLD.is_published THEN
      NEW.published_at := COALESCE(NEW.published_at, now());
      NEW.published_by := COALESCE(NEW.published_by, auth.uid());
    ELSIF NOT NEW.is_published AND OLD.is_published THEN
      NEW.published_at := NULL;
      NEW.published_by := NULL;
    END IF;
    IF NEW.archived AND NOT OLD.archived
       AND NOT (public.has_permission('assets.archive') OR auth.uid() IS NULL) THEN
      RAISE EXCEPTION 'Pengarsipan aset membutuhkan permission assets.archive';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.assets_before_write() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_assets_biur ON public.assets;
CREATE TRIGGER trg_assets_biur
  BEFORE INSERT OR UPDATE ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.assets_before_write();

-- =============================================================
-- 4. Default untuk inventory_items & asset_movements
-- =============================================================
-- barcode default = sku (Code 128 dibuat dari SKU/barcode).
CREATE OR REPLACE FUNCTION public.inventory_items_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.barcode IS NULL OR btrim(NEW.barcode) = '' THEN
    NEW.barcode := NEW.sku;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.inventory_items_before_insert() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_items_bi ON public.inventory_items;
CREATE TRIGGER trg_items_bi
  BEFORE INSERT ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.inventory_items_before_insert();

CREATE OR REPLACE FUNCTION public.asset_movements_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.moved_by IS NULL THEN
    NEW.moved_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.asset_movements_before_insert() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_movements_bi ON public.asset_movements;
CREATE TRIGGER trg_movements_bi
  BEFORE INSERT ON public.asset_movements
  FOR EACH ROW EXECUTE FUNCTION public.asset_movements_before_insert();

-- =============================================================
-- 5. Guard privilege: profiles & pemberian assets.publish
-- =============================================================
-- Hanya Super Admin yang boleh mengubah role_id / is_active.
-- Pengecualian auth.uid() IS NULL: hanya bisa dicapai oleh pemegang
-- BYPASSRLS (postgres/service_role, cth. saat bootstrap) yang memang
-- sudah berkuasa penuh; RLS tetap menolak user biasa sebelum trigger.
CREATE OR REPLACE FUNCTION public.guard_profile_privilege()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF (OLD.role_id IS DISTINCT FROM NEW.role_id
      OR OLD.is_active IS DISTINCT FROM NEW.is_active)
     AND NOT (public.is_super_admin() OR auth.uid() IS NULL) THEN
    RAISE EXCEPTION 'Hanya Super Admin yang boleh mengubah role/status aktif pengguna';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_profile_privilege() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_guard_profile_privilege ON public.profiles;
CREATE TRIGGER trg_guard_profile_privilege
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privilege();

-- assets.publish hanya boleh DIBERIKAN oleh Super Admin.
-- (RLS di 000002 sudah membatasi tulis ke super_admin; ini lapis kedua.)
CREATE OR REPLACE FUNCTION public.guard_publish_grant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_code text;
BEGIN
  SELECT p.code INTO v_code
  FROM public.permissions p
  WHERE p.id = NEW.permission_id;

  IF v_code = 'assets.publish'
     AND NOT (public.is_super_admin() OR auth.uid() IS NULL) THEN
    RAISE EXCEPTION 'Permission assets.publish hanya dapat diberikan oleh Super Admin';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_publish_grant() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_guard_publish_grant_role ON public.role_permissions;
CREATE TRIGGER trg_guard_publish_grant_role
  BEFORE INSERT OR UPDATE ON public.role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.guard_publish_grant();

DROP TRIGGER IF EXISTS trg_guard_publish_grant_user ON public.user_permissions;
CREATE TRIGGER trg_guard_publish_grant_user
  BEFORE INSERT OR UPDATE ON public.user_permissions
  FOR EACH ROW EXECUTE FUNCTION public.guard_publish_grant();

-- =============================================================
-- 6. AUDIT LOG (trigger AFTER pada tabel-tabel penting)
-- =============================================================
CREATE OR REPLACE FUNCTION public.log_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, new_data)
    VALUES (auth.uid(), 'INSERT', TG_TABLE_NAME, NEW.id::text, to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, old_data, new_data)
    VALUES (auth.uid(), 'UPDATE', TG_TABLE_NAME, NEW.id::text, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, old_data)
    VALUES (auth.uid(), 'DELETE', TG_TABLE_NAME, OLD.id::text, to_jsonb(OLD));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.log_audit() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_audit_assets ON public.assets;
CREATE TRIGGER trg_audit_assets
  AFTER INSERT OR UPDATE OR DELETE ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();

DROP TRIGGER IF EXISTS trg_audit_inventory_items ON public.inventory_items;
CREATE TRIGGER trg_audit_inventory_items
  AFTER INSERT OR UPDATE OR DELETE ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();

DROP TRIGGER IF EXISTS trg_audit_inventory_transactions ON public.inventory_transactions;
CREATE TRIGGER trg_audit_inventory_transactions
  AFTER INSERT OR UPDATE OR DELETE ON public.inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();

DROP TRIGGER IF EXISTS trg_audit_profiles ON public.profiles;
CREATE TRIGGER trg_audit_profiles
  AFTER INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();

-- =============================================================
-- 7. MESIN TRANSAKSI STOK (atomik, row locking, idempotency)
-- =============================================================

-- Pemetaan tipe transaksi -> permission yang dibutuhkan.
-- 'return' (retur barang ke gudang) memakai inventory.receive.
CREATE OR REPLACE FUNCTION public._txn_required_permission(p_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT CASE p_type
    WHEN 'in'       THEN 'inventory.receive'
    WHEN 'out'      THEN 'inventory.issue'
    WHEN 'transfer' THEN 'inventory.transfer'
    WHEN 'adjust'   THEN 'inventory.adjust'
    WHEN 'opname'   THEN 'inventory.adjust'
    WHEN 'return'   THEN 'inventory.receive'
    ELSE 'inventory.adjust'
  END;
$$;
REVOKE ALL ON FUNCTION public._txn_required_permission(text) FROM PUBLIC;

-- Ubah satu saldo + tulis ledger. Baris saldo dikunci (FOR UPDATE).
CREATE OR REPLACE FUNCTION public._change_balance(
  p_item_id       uuid,
  p_location_id   uuid,
  p_delta         numeric,
  p_transaction_id uuid
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

  IF v_qty + p_delta < 0 THEN
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
REVOKE ALL ON FUNCTION public._change_balance(uuid, uuid, numeric, uuid) FROM PUBLIC;

-- Terapkan efek stok untuk transaksi berstatus posted (dipanggil setelah
-- header + items ditulis). Validasi: item aktif, qty sesuai satuan,
-- tanda qty sesuai tipe. Transfer mengunci lokasi berurutan (anti-deadlock).
CREATE OR REPLACE FUNCTION public._apply_posted_effects(p_transaction_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  r        record;
  it       record;
  v_loc    uuid;
  v_delta  numeric(15,3);
  v_allow  boolean;
BEGIN
  SELECT * INTO r
  FROM public.inventory_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaksi % tidak ditemukan', p_transaction_id;
  END IF;
  IF r.status <> 'posted' THEN
    RAISE EXCEPTION 'Efek stok hanya boleh diterapkan untuk transaksi posted';
  END IF;

  FOR it IN
    SELECT *
    FROM public.inventory_transaction_items
    WHERE transaction_id = p_transaction_id
    ORDER BY item_id
  LOOP
    -- Item harus aktif; qty harus bulat bila satuan tidak desimal.
    SELECT u.allow_decimal INTO v_allow
    FROM public.inventory_items i
    JOIN public.units u ON u.id = i.unit_id
    WHERE i.id = it.item_id AND i.is_active;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item % tidak ditemukan atau tidak aktif', it.item_id;
    END IF;
    IF NOT COALESCE(v_allow, true) AND it.qty <> trunc(it.qty) THEN
      RAISE EXCEPTION 'Qty item % harus bilangan bulat sesuai satuannya', it.item_id;
    END IF;

    IF r.type = 'transfer' THEN
      IF it.qty <= 0 THEN
        RAISE EXCEPTION 'Qty transfer harus lebih dari 0';
      END IF;
      -- Kunci dalam urutan location_id yang konsisten.
      IF r.source_location_id < r.dest_location_id THEN
        PERFORM public._change_balance(it.item_id, r.source_location_id, -it.qty, p_transaction_id);
        PERFORM public._change_balance(it.item_id, r.dest_location_id,   it.qty, p_transaction_id);
      ELSE
        PERFORM public._change_balance(it.item_id, r.dest_location_id,   it.qty, p_transaction_id);
        PERFORM public._change_balance(it.item_id, r.source_location_id, -it.qty, p_transaction_id);
      END IF;
    ELSE
      IF r.type IN ('in', 'out', 'return') AND it.qty <= 0 THEN
        RAISE EXCEPTION 'Qty harus lebih dari 0 untuk transaksi tipe %', r.type;
      END IF;
      IF r.type IN ('adjust', 'opname') AND it.qty = 0 THEN
        RAISE EXCEPTION 'Qty tidak boleh 0 untuk transaksi tipe %', r.type;
      END IF;

      v_loc := CASE
        WHEN r.type IN ('in', 'return') THEN r.dest_location_id
        WHEN r.type = 'out'            THEN r.source_location_id
        ELSE COALESCE(r.source_location_id, r.dest_location_id)
      END;
      v_delta := CASE
        WHEN r.type = 'out' THEN -it.qty
        ELSE it.qty
      END;

      PERFORM public._change_balance(it.item_id, v_loc, v_delta, p_transaction_id);
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public._apply_posted_effects(uuid) FROM PUBLIC;

-- -------------------------------------------------------------
-- RPC: posting transaksi (atomik). Mengembalikan doc_number.
-- p_items: jsonb array [{item_id, qty, unit_price?, notes?}]
-- Idempotency: idempotency_key yang sudah ada -> kembalikan doc_number
-- lama TANPA efek ganda (termasuk saat balapan concurrent).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_inventory_transaction(
  p_idempotency_key   text,
  p_type              text,
  p_transaction_date  date,
  p_source_location_id uuid,
  p_dest_location_id   uuid,
  p_reference         text,
  p_notes             text,
  p_items             jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_key      text := COALESCE(
                       NULLIF(btrim(COALESCE(p_idempotency_key, '')), ''),
                       'auto-' || gen_random_uuid()::text);
  v_existing text;
  v_txn_id   uuid;
  v_doc      text;
  v_req      text;
  v_prefix   text;
BEGIN
  IF p_type NOT IN ('in', 'out', 'transfer', 'adjust', 'opname', 'return') THEN
    RAISE EXCEPTION 'Tipe transaksi tidak valid: %', p_type;
  END IF;

  v_req := public._txn_required_permission(p_type);
  IF NOT public.has_permission(v_req) THEN
    RAISE EXCEPTION 'Izin ditolak: butuh permission % untuk transaksi tipe %', v_req, p_type;
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Daftar item transaksi kosong';
  END IF;

  -- Aturan lokasi per tipe transaksi.
  IF p_type = 'in' AND (p_dest_location_id IS NULL OR p_source_location_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Barang masuk: dest_location wajib diisi, source_location harus kosong';
  END IF;
  IF p_type = 'out' AND (p_source_location_id IS NULL OR p_dest_location_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Barang keluar: source_location wajib diisi, dest_location harus kosong';
  END IF;
  IF p_type = 'transfer'
     AND (p_source_location_id IS NULL OR p_dest_location_id IS NULL
          OR p_source_location_id = p_dest_location_id) THEN
    RAISE EXCEPTION 'Transfer: source & dest wajib diisi dan harus berbeda';
  END IF;
  IF p_type IN ('adjust', 'opname')
     AND (p_source_location_id IS NULL) = (p_dest_location_id IS NULL) THEN
    RAISE EXCEPTION 'Adjust/opname: isi tepat satu lokasi (source atau dest)';
  END IF;
  IF p_type = 'return' AND (p_dest_location_id IS NULL OR p_source_location_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Retur: dest_location wajib diisi, source_location harus kosong';
  END IF;

  -- Idempotency: sudah pernah diproses -> kembalikan yang lama.
  SELECT doc_number INTO v_existing
  FROM public.inventory_transactions
  WHERE idempotency_key = v_key;
  IF FOUND THEN
    RETURN v_existing;
  END IF;

  v_prefix := CASE p_type
    WHEN 'in' THEN 'IN' WHEN 'out' THEN 'OUT' WHEN 'transfer' THEN 'TRF'
    WHEN 'adjust' THEN 'ADJ' WHEN 'opname' THEN 'OPN' WHEN 'return' THEN 'RTN'
  END;
  v_doc := public.next_doc_number(v_prefix);

  BEGIN
    INSERT INTO public.inventory_transactions (
      doc_number, type, status, transaction_date,
      source_location_id, dest_location_id,
      reference, notes, idempotency_key, created_by, posted_at
    )
    VALUES (
      v_doc, p_type, 'posted', COALESCE(p_transaction_date, CURRENT_DATE),
      p_source_location_id, p_dest_location_id,
      NULLIF(btrim(COALESCE(p_reference, '')), ''),
      NULLIF(btrim(COALESCE(p_notes, '')), ''),
      v_key, auth.uid(), now()
    )
    RETURNING id INTO v_txn_id;
  EXCEPTION WHEN unique_violation THEN
    -- Balapan idempotency_key antar request concurrent.
    SELECT doc_number INTO v_existing
    FROM public.inventory_transactions
    WHERE idempotency_key = v_key;
    IF FOUND THEN
      RETURN v_existing;
    END IF;
    RAISE;
  END;

  INSERT INTO public.inventory_transaction_items
    (transaction_id, item_id, qty, unit_price, notes)
  SELECT
    v_txn_id,
    NULLIF(e ->> 'item_id', '')::uuid,
    (e ->> 'qty')::numeric,
    NULLIF(e ->> 'unit_price', '')::numeric,
    NULLIF(btrim(COALESCE(e ->> 'notes', '')), '')
  FROM jsonb_array_elements(p_items) AS e;

  PERFORM public._apply_posted_effects(v_txn_id);

  RETURN v_doc;
END;
$$;
REVOKE ALL ON FUNCTION public.post_inventory_transaction(text, text, date, uuid, uuid, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_inventory_transaction(text, text, date, uuid, uuid, text, text, jsonb) TO authenticated;

-- -------------------------------------------------------------
-- RPC: koreksi transaksi posted via transaksi koreksi baru.
-- Histori asal TIDAK diubah (hanya status -> reversed).
-- Mengembalikan doc_number transaksi koreksi.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_inventory_transaction(
  p_transaction_id uuid,
  p_reason         text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  r        record;
  v_new_id uuid;
  v_doc    text;
  v_key    text;
  v_req    text;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Alasan koreksi wajib diisi';
  END IF;

  SELECT * INTO r
  FROM public.inventory_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaksi % tidak ditemukan', p_transaction_id;
  END IF;
  IF r.status <> 'posted' THEN
    RAISE EXCEPTION 'Hanya transaksi posted yang bisa dikoreksi (status saat ini: %)', r.status;
  END IF;

  v_req := public._txn_required_permission(r.type);
  IF NOT public.has_permission(v_req) THEN
    RAISE EXCEPTION 'Izin ditolak: butuh permission % untuk mengoreksi transaksi %', v_req, r.type;
  END IF;

  v_key := 'rev-' || gen_random_uuid()::text;
  v_doc := public.next_doc_number('REV');

  INSERT INTO public.inventory_transactions (
    doc_number, type, status, transaction_date,
    source_location_id, dest_location_id,
    reference, notes, idempotency_key, created_by, posted_at,
    reversal_of, reversal_reason
  )
  VALUES (
    v_doc, r.type, 'posted', CURRENT_DATE,
    r.source_location_id, r.dest_location_id,
    'Koreksi atas ' || r.doc_number, btrim(p_reason),
    v_key, auth.uid(), now(),
    r.id, btrim(p_reason)
  )
  RETURNING id INTO v_new_id;

  -- Qty dibalik; validasi stok (termasuk kecukupan untuk koreksi keluar)
  -- dilakukan di _apply_posted_effects -> _change_balance.
  INSERT INTO public.inventory_transaction_items
    (transaction_id, item_id, qty, unit_price, notes)
  SELECT v_new_id, item_id, -qty, unit_price, 'koreksi atas ' || r.doc_number
  FROM public.inventory_transaction_items
  WHERE transaction_id = r.id;

  PERFORM public._apply_posted_effects(v_new_id);

  UPDATE public.inventory_transactions
     SET status = 'reversed',
         reversed_at = now()
   WHERE id = r.id;

  RETURN v_doc;
END;
$$;
REVOKE ALL ON FUNCTION public.reverse_inventory_transaction(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reverse_inventory_transaction(uuid, text) TO authenticated;

-- -------------------------------------------------------------
-- RPC: finalisasi stock opname.
-- system_qty di-refresh dari saldo aktual (dikunci), selisih
-- (counted - system) diposting sebagai transaksi 'opname'.
-- Mengembalikan doc_number transaksi opname.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_stock_count(p_stock_count_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  sc       record;
  ci       record;
  v_sys    numeric(15,3);
  v_new_id uuid;
  v_doc    text;
  v_key    text;
BEGIN
  SELECT * INTO sc
  FROM public.stock_counts
  WHERE id = p_stock_count_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock opname % tidak ditemukan', p_stock_count_id;
  END IF;
  IF sc.status <> 'draft' THEN
    RAISE EXCEPTION 'Hanya opname berstatus draft yang bisa difinalisasi (status: %)', sc.status;
  END IF;
  IF NOT public.has_permission('inventory.adjust') THEN
    RAISE EXCEPTION 'Izin ditolak: butuh permission inventory.adjust';
  END IF;

  -- Refresh system_qty dari saldo aktual + validasi counted terisi.
  FOR ci IN
    SELECT *
    FROM public.stock_count_items
    WHERE stock_count_id = sc.id
    FOR UPDATE
  LOOP
    IF ci.counted_qty IS NULL THEN
      RAISE EXCEPTION 'Item % belum dihitung (counted_qty masih kosong)', ci.item_id;
    END IF;

    INSERT INTO public.inventory_balances (item_id, location_id, qty)
    VALUES (ci.item_id, sc.location_id, 0)
    ON CONFLICT DO NOTHING;

    SELECT qty INTO v_sys
    FROM public.inventory_balances
    WHERE item_id = ci.item_id AND location_id = sc.location_id
    FOR UPDATE;

    UPDATE public.stock_count_items
       SET system_qty = COALESCE(v_sys, 0)
     WHERE id = ci.id;
  END LOOP;

  v_key := 'opname-' || gen_random_uuid()::text;
  v_doc := public.next_doc_number('OPN');

  INSERT INTO public.inventory_transactions (
    doc_number, type, status, transaction_date,
    source_location_id, dest_location_id,
    reference, notes, idempotency_key, created_by, posted_at
  )
  VALUES (
    v_doc, 'opname', 'posted', CURRENT_DATE,
    sc.location_id, NULL,
    'Opname ' || sc.doc_number, sc.notes,
    v_key, auth.uid(), now()
  )
  RETURNING id INTO v_new_id;

  -- Hanya selisih non-nol yang diposting.
  INSERT INTO public.inventory_transaction_items
    (transaction_id, item_id, qty, notes)
  SELECT v_new_id, item_id, (counted_qty - system_qty),
         'selisih opname ' || sc.doc_number
  FROM public.stock_count_items
  WHERE stock_count_id = sc.id
    AND (counted_qty - system_qty) <> 0;

  PERFORM public._apply_posted_effects(v_new_id);

  UPDATE public.stock_counts
     SET status = 'posted',
         posted_at = now()
   WHERE id = sc.id;

  RETURN v_doc;
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_stock_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_stock_count(uuid) TO authenticated;

-- =============================================================
-- 8. RPC PUBLIK (whitelist kolom eksplisit — TANPA data privat)
-- Kolom yang dikembalikan: public_code, name, category, brand, model,
-- condition, status, photo_url, department, published_at.
-- TIDAK ADA: purchase_price, serial_number, custodian, location detail,
-- created_by/published_by (identitas admin), archived, dsb.
-- Hanya aset is_published=true dan archived=false.
-- =============================================================
CREATE OR REPLACE FUNCTION public.get_public_asset(p_public_code text)
RETURNS TABLE (
  public_code  text,
  name         text,
  category     text,
  brand        text,
  model        text,
  condition    text,
  status       text,
  photo_url    text,
  department   text,
  published_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    a.public_code,
    a.name,
    c.name,
    a.brand,
    a.model,
    a.condition,
    a.status,
    a.photo_url,
    d.name,
    a.published_at
  FROM public.assets a
  LEFT JOIN public.asset_categories c ON c.id = a.category_id
  LEFT JOIN public.departments d ON d.id = a.department_id
  WHERE a.public_code = p_public_code
    AND a.is_published
    AND NOT a.archived;
$$;
REVOKE ALL ON FUNCTION public.get_public_asset(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_asset(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.search_public_assets(
  p_query    text    DEFAULT NULL,
  p_category text    DEFAULT NULL,
  p_limit    integer DEFAULT 20,
  p_offset   integer DEFAULT 0
)
RETURNS TABLE (
  public_code  text,
  name         text,
  category     text,
  brand        text,
  model        text,
  condition    text,
  status       text,
  photo_url    text,
  department   text,
  published_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    a.public_code,
    a.name,
    c.name,
    a.brand,
    a.model,
    a.condition,
    a.status,
    a.photo_url,
    d.name,
    a.published_at
  FROM public.assets a
  LEFT JOIN public.asset_categories c ON c.id = a.category_id
  LEFT JOIN public.departments d ON d.id = a.department_id
  WHERE a.is_published
    AND NOT a.archived
    AND (
      NULLIF(btrim(COALESCE(p_query, '')), '') IS NULL
      OR a.name ILIKE '%' || btrim(p_query) || '%'
      OR a.public_code ILIKE '%' || btrim(p_query) || '%'
    )
    AND (
      NULLIF(btrim(COALESCE(p_category, '')), '') IS NULL
      OR c.code = btrim(p_category)
      OR c.name ILIKE btrim(p_category)
    )
  ORDER BY a.name, a.public_code
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;
REVOKE ALL ON FUNCTION public.search_public_assets(text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_public_assets(text, text, integer, integer) TO anon, authenticated;
