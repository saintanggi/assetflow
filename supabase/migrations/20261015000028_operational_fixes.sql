-- =============================================================
-- 20261015000028 — Perbaikan Operasional Harian & Keamanan
-- =============================================================
-- Mencakup:
-- 1. Drop CHECK constraint qty >= 0 di inventory_balances & inventory_ledger
--    agar fitur p_allow_negative (upload massal) dan rekonsiliasi stok awal
--    tidak gagal karena constraint database.
-- 2. Sinkronisasi permission & role operasional (is_staff, is_super_admin,
--    has_permission, role_permissions) untuk admin_ho, admin_gudang, helper.
-- 3. Sinkronisasi otomatis user_accounts -> profiles (backfill + trigger)
--    agar FK requested_by / reviewed_by / processed_by dan nama user valid.
-- 4. RPC resolve_login_email(p_username) + hapus policy anon SELECT penuh
--    di user_accounts (mencegah kebocoran daftar username/role ke publik).
-- 5. Perbaikan set_opening_stock: hitung qty = opening_qty + mutasi ledger
--    agar saldo aktual selalu konsisten dengan tampilan Asset Baru/Return/Unready.
-- 6. Perbaikan ship_request_items:
--    - SET search_path tetap + row lock FOR UPDATE
--    - izinkan kirim item berstatus 'diproses' selain 'disetujui'/'siap'/'pending_sebagian'
--    - catat transaction_date sesuai request_date, serta gerai & status_aset
--    - perbaiki status header request ('selesai' hanya bila SEMUA item sudah
--      terkirim/ditolak; 'disetujui_sebagian' bila masih ada pending_sebagian
--      atau menunggu_stok; selain itu 'diproses')
--    - perbaiki data lama yang terlanjur nyangkut di status 'selesai'.
-- 7. Perbaikan reverse_inventory_transaction: salin resi, gerai, status_aset.
-- 8. Perketat policy write bucket storage item-photos.
-- =============================================================

-- ---------- 1. Longgarkan CHECK constraint saldo & ledger untuk upload minus ----------
ALTER TABLE public.inventory_balances
  DROP CONSTRAINT IF EXISTS inventory_balances_qty_check;

ALTER TABLE public.inventory_ledger
  DROP CONSTRAINT IF EXISTS inventory_ledger_qty_after_check;

-- ---------- 2. Lengkapi katalog permissions & role_permissions ----------
INSERT INTO public.permissions (code, description)
VALUES
  ('inventory.manage', 'Mengatur stok awal & master persediaan'),
  ('requests.view',    'Melihat daftar & detail permintaan barang'),
  ('requests.create',  'Membuat & upload permintaan barang (Admin HO)'),
  ('requests.review',  'Mereview, menyetujui & mengirim permintaan (Admin Gudang)'),
  ('requests.approve', 'Menyetujui permintaan barang (Admin Gudang)'),
  ('requests.process', 'Memproses & menyiapkan barang permintaan (Helper)')
ON CONFLICT (code) DO NOTHING;

-- Pastikan roles operasional ada.
INSERT INTO public.roles (name, description)
VALUES
  ('admin_ho',     'Admin Kantor Pusat: membuat permintaan barang'),
  ('admin_gudang', 'Admin Gudang: review & approve permintaan, kelola pengiriman'),
  ('helper',       'Helper / team proses gudang: memproses & menyiapkan barang')
ON CONFLICT (name) DO NOTHING;

-- Sinkronkan role_permissions.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'super_admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'admin_ho'
  AND p.code IN ('requests.view', 'requests.create', 'inventory.view', 'reports.view')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'admin_gudang'
  AND p.code IN (
    'requests.view', 'requests.create', 'requests.review', 'requests.approve',
    'inventory.view', 'inventory.receive', 'inventory.issue', 'inventory.transfer',
    'inventory.adjust', 'labels.print', 'reports.view', 'reports.export'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'helper'
  AND p.code IN ('requests.view', 'requests.process', 'inventory.view', 'labels.print')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ---------- 3. Helper otorisasi: is_super_admin, is_staff, has_permission ----------
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_accounts ua
    WHERE ua.auth_user_id = v_user AND ua.role = 'super_admin' AND ua.is_active
  ) THEN
    RETURN true;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.roles r ON r.id = p.role_id
    WHERE p.id = v_user AND r.name = 'super_admin' AND p.is_active
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
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RETURN false;
  END IF;
  -- Semua akun operasional aktif di user_accounts adalah staf.
  IF EXISTS (
    SELECT 1 FROM public.user_accounts ua
    WHERE ua.auth_user_id = v_user AND ua.is_active
  ) THEN
    RETURN true;
  END IF;
  -- Semua profil aktif yang punya role valid.
  RETURN EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.roles r ON r.id = p.role_id
    WHERE p.id = v_user
      AND p.is_active
      AND r.name IN ('super_admin', 'admin', 'admin_ho', 'admin_gudang', 'helper')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.has_permission(p_code text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user     uuid := auth.uid();
  v_active   boolean;
  v_override boolean;
  v_role     text;
  v_perms    text[];
BEGIN
  IF v_user IS NULL THEN
    RETURN false;
  END IF;

  -- 1) Cek akun operasional dulu.
  SELECT ua.role, ua.is_active INTO v_role, v_active
  FROM public.user_accounts ua
  WHERE ua.auth_user_id = v_user;

  IF v_role IS NOT NULL THEN
    IF NOT COALESCE(v_active, false) THEN
      RETURN false;
    END IF;
    v_perms := CASE v_role
      WHEN 'super_admin'  THEN ARRAY['*']
      WHEN 'admin_ho'     THEN ARRAY[
        'requests.view', 'requests.create', 'inventory.view', 'reports.view'
      ]
      WHEN 'admin_gudang' THEN ARRAY[
        'requests.view', 'requests.create', 'requests.review', 'requests.approve',
        'inventory.view', 'inventory.receive', 'inventory.issue', 'inventory.transfer',
        'inventory.adjust', 'labels.print', 'reports.view', 'reports.export'
      ]
      WHEN 'helper'       THEN ARRAY[
        'requests.view', 'requests.process', 'inventory.view', 'labels.print'
      ]
      ELSE ARRAY[]::text[]
    END;
    IF v_perms @> ARRAY['*'] THEN
      RETURN true;
    END IF;
    RETURN v_perms @> ARRAY[p_code];
  END IF;

  -- 2) Fallback ke sistem profiles/roles.
  SELECT p.is_active INTO v_active
  FROM public.profiles p
  WHERE p.id = v_user;

  IF NOT COALESCE(v_active, false) THEN
    RETURN false;
  END IF;

  IF public.is_super_admin() THEN
    RETURN true;
  END IF;

  SELECT up.granted INTO v_override
  FROM public.user_permissions up
  JOIN public.permissions pm ON pm.id = up.permission_id
  WHERE up.user_id = v_user
    AND pm.code = p_code;

  IF v_override IS NOT NULL THEN
    RETURN v_override;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.role_permissions rp ON rp.role_id = p.role_id
    JOIN public.permissions pm ON pm.id = rp.permission_id
    WHERE p.id = v_user
      AND pm.code = p_code
  );
END;
$$;

-- ---------- 4. Sinkronisasi user_accounts -> profiles ----------
CREATE OR REPLACE FUNCTION public.sync_user_account_to_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_role_id uuid;
BEGIN
  IF NEW.auth_user_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT id INTO v_role_id FROM public.roles WHERE name = NEW.role LIMIT 1;

  INSERT INTO public.profiles (id, email, full_name, role_id, is_active)
  VALUES (
    NEW.auth_user_id,
    NEW.username || '@inventory.internal',
    NEW.display_name,
    v_role_id,
    NEW.is_active
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name  = EXCLUDED.full_name,
    role_id    = COALESCE(EXCLUDED.role_id, public.profiles.role_id),
    is_active  = EXCLUDED.is_active,
    updated_at = now();

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_user_account_to_profile() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_sync_user_account_to_profile ON public.user_accounts;
CREATE TRIGGER trg_sync_user_account_to_profile
  AFTER INSERT OR UPDATE ON public.user_accounts
  FOR EACH ROW EXECUTE FUNCTION public.sync_user_account_to_profile();

-- Backfill semua akun operasional yang sudah ada ke profiles.
INSERT INTO public.profiles (id, email, full_name, role_id, is_active)
SELECT
  ua.auth_user_id,
  ua.username || '@inventory.internal',
  ua.display_name,
  r.id,
  ua.is_active
FROM public.user_accounts ua
LEFT JOIN public.roles r ON r.name = ua.role
WHERE ua.auth_user_id IS NOT NULL
ON CONFLICT (id) DO UPDATE SET
  full_name  = EXCLUDED.full_name,
  role_id    = COALESCE(EXCLUDED.role_id, public.profiles.role_id),
  is_active  = EXCLUDED.is_active,
  updated_at = now();

-- ---------- 5. Login username aman (tanpa buka tabel user_accounts ke anon) ----------
CREATE OR REPLACE FUNCTION public.resolve_login_email(p_username text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
  SELECT COALESCE(
    (SELECT u.email
     FROM public.user_accounts ua
     JOIN auth.users u ON u.id = ua.auth_user_id
     WHERE ua.username = lower(btrim(p_username))
       AND ua.is_active
     LIMIT 1),
    CASE
      WHEN position('@' in btrim(p_username)) > 0 THEN lower(btrim(p_username))
      ELSE lower(btrim(p_username)) || '@inventory.internal'
    END
  );
$$;
GRANT EXECUTE ON FUNCTION public.resolve_login_email(text) TO anon, authenticated;

-- Hapus policy anon SELECT penuh pada user_accounts.
DROP POLICY IF EXISTS "user_accounts anon login lookup" ON public.user_accounts;

-- Izinkan staf terautentikasi membaca nama tampilan untuk log transaksi.
DROP POLICY IF EXISTS "user_accounts staff read" ON public.user_accounts;
CREATE POLICY "user_accounts staff read"
ON public.user_accounts FOR SELECT
TO authenticated
USING (public.is_staff());

-- ---------- 6. Perbaiki set_opening_stock & rekonsiliasi saldo ----------
CREATE OR REPLACE FUNCTION public.set_opening_stock(
  p_item_id     uuid,
  p_location_id uuid,
  p_qty         numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_net_movement numeric(15,3);
  v_new_qty      numeric(15,3);
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

  SELECT COALESCE(SUM(qty_change), 0)
    INTO v_net_movement
    FROM public.inventory_ledger
   WHERE item_id = p_item_id
     AND location_id = p_location_id;

  v_new_qty := p_qty + v_net_movement;

  INSERT INTO public.inventory_balances (item_id, location_id, qty, opening_qty)
  VALUES (p_item_id, p_location_id, v_new_qty, p_qty)
  ON CONFLICT (item_id, location_id)
  DO UPDATE SET
    opening_qty = EXCLUDED.opening_qty,
    qty         = EXCLUDED.qty,
    updated_at  = now();
END;
$$;
REVOKE ALL ON FUNCTION public.set_opening_stock(uuid, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_opening_stock(uuid, uuid, numeric) TO authenticated;

-- Rekonsiliasi saldo lokasi kondisi (STOK-BARU, STOK-RETUR, STOK-UNREADY)
-- agar qty = opening_qty + SUM(ledger.qty_change).
UPDATE public.inventory_balances b
   SET qty = COALESCE(b.opening_qty, 0) + COALESCE((
     SELECT SUM(l.qty_change)
       FROM public.inventory_ledger l
      WHERE l.item_id = b.item_id
        AND l.location_id = b.location_id
   ), 0),
       updated_at = now()
 WHERE b.location_id IN (
   SELECT id FROM public.locations WHERE code IN ('STOK-BARU', 'STOK-RETUR', 'STOK-UNREADY')
 );

-- ---------- 7. Perbaiki ship_request_items ----------
CREATE OR REPLACE FUNCTION public.ship_request_items(
  p_request_id     uuid,
  p_location_id    uuid,
  p_lines          jsonb,
  p_notes          text    DEFAULT NULL,
  p_allow_negative boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_req_status  text;
  v_req_number  text;
  v_req_date    date;
  v_branch_name text;
  v_txn_id      uuid;
  v_line        jsonb;
  v_ri_id       uuid;
  v_qty         numeric;
  v_resi        text;
  v_item_id     uuid;
  v_approved    numeric;
  v_shipped     numeric;
  v_item_status text;
  v_status_aset text;
  v_norm_aset   text;
BEGIN
  IF NOT (public.has_permission('requests.review') OR public.has_permission('requests.approve')) THEN
    RAISE EXCEPTION 'Tidak punya izin mengirim permintaan';
  END IF;

  SELECT status, request_number, request_date, branch_name
    INTO v_req_status, v_req_number, v_req_date, v_branch_name
    FROM public.requests
   WHERE id = p_request_id
   FOR UPDATE;

  IF v_req_status IS NULL THEN
    RAISE EXCEPTION 'Permintaan tidak ditemukan';
  END IF;
  IF v_req_status NOT IN ('disetujui', 'disetujui_sebagian', 'diproses', 'selesai') THEN
    RAISE EXCEPTION 'Permintaan belum disetujui (status: %)', v_req_status;
  END IF;

  INSERT INTO public.inventory_transactions (
    type, status, transaction_date, source_location_id, notes, reference, created_by, posted_at
  )
  VALUES (
    'out', 'posted', COALESCE(v_req_date, CURRENT_DATE), p_location_id, p_notes,
    'REQ-KIRIM/' || v_req_number, auth.uid(), now()
  )
  RETURNING id INTO v_txn_id;

  CREATE TEMP TABLE tmp_ship_lines (
    item_id     uuid,
    qty         numeric,
    resi        text,
    status_aset text
  ) ON COMMIT DROP;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_ri_id := (v_line->>'request_item_id')::uuid;
    v_qty   := (v_line->>'qty')::numeric;
    v_resi  := NULLIF(btrim(COALESCE(v_line->>'resi', '')), '');

    SELECT item_id, qty_approved, qty_shipped, item_status, status_aset
      INTO v_item_id, v_approved, v_shipped, v_item_status, v_status_aset
      FROM public.request_items
     WHERE id = v_ri_id AND request_id = p_request_id
     FOR UPDATE;

    IF v_item_id IS NULL THEN
      RAISE EXCEPTION 'Item permintaan tidak valid';
    END IF;
    IF v_approved IS NULL THEN
      RAISE EXCEPTION 'Item belum di-approve (id %)', v_ri_id;
    END IF;
    IF v_item_status NOT IN ('disetujui', 'diproses', 'siap', 'pending_sebagian') THEN
      RAISE EXCEPTION 'Item belum siap dikirim (status: %)', v_item_status;
    END IF;
    IF v_qty <= 0 OR v_qty > (v_approved - v_shipped) THEN
      RAISE EXCEPTION 'Qty kirim % melebihi sisa %', v_qty, (v_approved - v_shipped);
    END IF;

    v_norm_aset := CASE
      WHEN upper(COALESCE(v_status_aset, '')) LIKE '%UNREADY%' THEN 'UNREADY'
      WHEN upper(COALESCE(v_status_aset, '')) LIKE '%RETUR%'   THEN 'ASSET RETUR'
      ELSE 'ASSET BARU'
    END;

    UPDATE public.request_items
       SET qty_shipped = qty_shipped + v_qty,
           resi        = COALESCE(v_resi, resi),
           item_status = CASE
             WHEN qty_shipped + v_qty >= qty_approved THEN 'terkirim'
             ELSE 'pending_sebagian'
           END,
           updated_at  = now()
     WHERE id = v_ri_id;

    INSERT INTO tmp_ship_lines VALUES (v_item_id, v_qty, v_resi, v_norm_aset);
  END LOOP;

  -- Agregasi per item_id (hindari pelanggaran uq_txn_item).
  INSERT INTO public.inventory_transaction_items
    (transaction_id, item_id, qty, notes, resi, gerai, status_aset)
  SELECT
    v_txn_id,
    item_id,
    SUM(qty),
    'Kirim permintaan ' || v_req_number,
    NULLIF(STRING_AGG(DISTINCT resi, ', ' ORDER BY resi), ''),
    v_branch_name,
    MAX(status_aset)
  FROM tmp_ship_lines
  GROUP BY item_id;

  DROP TABLE tmp_ship_lines;

  PERFORM public._apply_posted_effects(v_txn_id, p_allow_negative);

  -- Update status header request secara akurat:
  -- 'selesai' hanya jika seluruh baris item sudah 'terkirim' atau 'ditolak'.
  UPDATE public.requests
     SET status = CASE
           WHEN NOT EXISTS (
             SELECT 1 FROM public.request_items
              WHERE request_id = p_request_id
                AND item_status NOT IN ('terkirim', 'ditolak')
           ) THEN 'selesai'
           WHEN EXISTS (
             SELECT 1 FROM public.request_items
              WHERE request_id = p_request_id
                AND item_status IN ('pending_sebagian', 'menunggu_stok')
           ) THEN 'disetujui_sebagian'
           ELSE 'diproses'
         END,
         updated_at = now()
   WHERE id = p_request_id;

  RETURN v_txn_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ship_request_items(uuid, uuid, jsonb, text, boolean) TO authenticated;

-- Perbaiki permintaan lama yang terlanjur berstatus 'selesai' padahal masih punya item belum terkirim.
UPDATE public.requests r
   SET status = CASE
         WHEN EXISTS (
           SELECT 1 FROM public.request_items ri
            WHERE ri.request_id = r.id
              AND ri.item_status IN ('pending_sebagian', 'menunggu_stok')
         ) THEN 'disetujui_sebagian'
         ELSE 'diproses'
       END,
       updated_at = now()
 WHERE r.status = 'selesai'
   AND EXISTS (
     SELECT 1 FROM public.request_items ri
      WHERE ri.request_id = r.id
        AND ri.item_status NOT IN ('terkirim', 'ditolak')
   );

-- ---------- 8. Perbaiki reverse_inventory_transaction (salin resi, gerai, status_aset) ----------
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
  r            record;
  v_new_id     uuid;
  v_doc        text;
  v_key        text;
  v_req        text;
  v_new_type   text;
  v_new_source uuid;
  v_new_dest   uuid;
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

  v_new_type := CASE r.type
    WHEN 'out'    THEN 'in'
    WHEN 'in'     THEN 'out'
    WHEN 'return' THEN 'out'
    ELSE r.type
  END;
  v_new_source := CASE
    WHEN r.type = 'out'             THEN NULL
    WHEN r.type IN ('in', 'return') THEN r.dest_location_id
    WHEN r.type = 'transfer'        THEN r.dest_location_id
    ELSE r.source_location_id
  END;
  v_new_dest := CASE
    WHEN r.type = 'out'             THEN r.source_location_id
    WHEN r.type IN ('in', 'return') THEN NULL
    WHEN r.type = 'transfer'        THEN r.source_location_id
    ELSE r.dest_location_id
  END;

  v_req := public._txn_required_permission(v_new_type);
  IF NOT (public.has_permission(v_req) OR public.is_super_admin()) THEN
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
    v_doc, v_new_type, 'posted', CURRENT_DATE,
    v_new_source, v_new_dest,
    'Koreksi atas ' || r.doc_number, btrim(p_reason),
    v_key, auth.uid(), now(),
    r.id, btrim(p_reason)
  )
  RETURNING id INTO v_new_id;

  INSERT INTO public.inventory_transaction_items
    (transaction_id, item_id, qty, unit_price, notes, resi, gerai, status_aset)
  SELECT v_new_id, item_id,
         CASE WHEN r.type IN ('adjust', 'opname') THEN -qty ELSE qty END,
         unit_price, 'koreksi atas ' || r.doc_number,
         resi, gerai, status_aset
  FROM public.inventory_transaction_items
  WHERE transaction_id = r.id;

  PERFORM public._apply_posted_effects(v_new_id, true);

  UPDATE public.inventory_transactions
     SET status = 'reversed',
         reversed_at = now()
   WHERE id = r.id;

  RETURN v_doc;
END;
$$;

-- ---------- 9. Perketat policy storage item-photos ----------
DROP POLICY IF EXISTS "item-photos authenticated write" ON storage.objects;
CREATE POLICY "item-photos authenticated write"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'item-photos'
  AND (
    public.has_permission('inventory.manage')
    OR public.has_permission('inventory.adjust')
    OR public.has_permission('settings.manage')
    OR public.is_super_admin()
  )
);

DROP POLICY IF EXISTS "item-photos authenticated update" ON storage.objects;
CREATE POLICY "item-photos authenticated update"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'item-photos'
  AND (
    public.has_permission('inventory.manage')
    OR public.has_permission('inventory.adjust')
    OR public.has_permission('settings.manage')
    OR public.is_super_admin()
  )
);

DROP POLICY IF EXISTS "item-photos authenticated delete" ON storage.objects;
CREATE POLICY "item-photos authenticated delete"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'item-photos'
  AND (
    public.has_permission('inventory.manage')
    OR public.has_permission('inventory.adjust')
    OR public.has_permission('settings.manage')
    OR public.is_super_admin()
  )
);
