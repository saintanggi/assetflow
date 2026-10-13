-- =============================================================
-- Inventory Warehouse — Migrasi 000007: Workflow Permintaan Barang
-- (HO -> Admin Gudang review -> Helper proses -> kirim)
-- =============================================================
-- Idempoten: aman dijalankan ulang.
-- =============================================================

-- ---------- 1. Tabel requests ----------
CREATE TABLE IF NOT EXISTS public.requests (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number  text        NOT NULL UNIQUE,   -- REQ-2026-000001 (otomatis)
  ticket_no       text        NOT NULL,          -- no tiket dari HO
  request_date    date        NOT NULL DEFAULT CURRENT_DATE,
  branch_name     text        NOT NULL,          -- cabang / gerai
  branch_code     text,                          -- kode gerai (opsional)
  status          text        NOT NULL DEFAULT 'diajukan'
                CHECK (status IN ('diajukan','disetujui','disetujui_sebagian','ditolak','diproses','selesai')),
  requested_by    uuid        REFERENCES public.profiles(id),
  reviewed_by     uuid        REFERENCES public.profiles(id),
  reviewed_at     timestamptz,
  rejection_reason text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_requests_status ON public.requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_date ON public.requests(request_date DESC);

-- ---------- 2. Tabel request_items ----------
CREATE TABLE IF NOT EXISTS public.request_items (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      uuid        NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
  item_id         uuid        NOT NULL REFERENCES public.inventory_items(id),
  qty_requested   numeric(18,3) NOT NULL CHECK (qty_requested > 0),
  qty_approved    numeric(18,3),                       -- diisi admin gudang saat review
  qty_shipped     numeric(18,3) NOT NULL DEFAULT 0,    -- terakumulasi per pengiriman
  barcode         text,                                -- wajib diisi helper saat proses
  serial_number   text,                                -- opsional
  item_type       text,                                -- type barang
  status_aset     text,                                -- ASSET BARU / ASSET RETUR / UNREADY
  resi            text,                                -- no resi pengiriman
  item_status     text        NOT NULL DEFAULT 'menunggu'
                CHECK (item_status IN ('menunggu','disetujui','ditolak','diproses','siap','terkirim','pending_sebagian')),
  notes           text,
  processed_by    uuid        REFERENCES public.profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_request_item UNIQUE (request_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_request_items_request ON public.request_items(request_id);
CREATE INDEX IF NOT EXISTS idx_request_items_status ON public.request_items(item_status);

-- ---------- 3. Penomoran otomatis ----------
CREATE SEQUENCE IF NOT EXISTS public.request_number_seq START 1;

CREATE OR REPLACE FUNCTION public.next_request_number()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_year text := to_char(now(), 'YYYY'); v_n bigint;
BEGIN
  v_n := nextval('public.request_number_seq');
  RETURN 'REQ-' || v_year || '-' || lpad(v_n::text, 6, '0');
END $$;

CREATE OR REPLACE FUNCTION public.requests_set_number()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.request_number IS NULL OR NEW.request_number = '' THEN
    NEW.request_number := public.next_request_number();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_requests_set_number ON public.requests;
CREATE TRIGGER trg_requests_set_number
  BEFORE INSERT OR UPDATE ON public.requests
  FOR EACH ROW EXECUTE FUNCTION public.requests_set_number();

CREATE OR REPLACE FUNCTION public.request_items_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_request_items_touch ON public.request_items;
CREATE TRIGGER trg_request_items_touch
  BEFORE UPDATE ON public.request_items
  FOR EACH ROW EXECUTE FUNCTION public.request_items_touch();

-- ---------- 4. Roles & permissions baru ----------
INSERT INTO public.roles (name, description)
VALUES
  ('admin_ho',     'Admin Kantor Pusat: membuat permintaan barang'),
  ('admin_gudang', 'Admin Gudang: review & approve permintaan, kelola pengiriman'),
  ('helper',       'Helper / team proses gudang: memproses & menyiapkan barang')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.permissions (code, description)
VALUES
  ('requests.view',   'Melihat daftar permintaan barang'),
  ('requests.create', 'Membuat permintaan barang baru (Admin Kantor)'),
  ('requests.review', 'Mereview & menyetujui permintaan (Admin Gudang)'),
  ('requests.process','Memproses & menyiapkan barang permintaan (Helper)')
ON CONFLICT (code) DO NOTHING;

-- super_admin: semua permission (termasuk yang baru).
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'super_admin' AND p.code LIKE 'requests.%'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- admin_ho: view + create (+ inventory.view agar bisa lihat barang).
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'admin_ho'
  AND p.code IN ('requests.view','requests.create','inventory.view','reports.view')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- admin_gudang: view + review (+ issue agar bisa kirim, transfer, labels).
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'admin_gudang'
  AND p.code IN ('requests.view','requests.review','inventory.view','inventory.issue','inventory.transfer','labels.print','reports.view','reports.export')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- helper: view + process (+ inventory.view).
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'helper'
  AND p.code IN ('requests.view','requests.process','inventory.view','labels.print')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ---------- 5. RLS ----------
ALTER TABLE public.requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS requests_select ON public.requests;
CREATE POLICY requests_select ON public.requests
  FOR SELECT TO authenticated
  USING (public.has_permission('requests.view'));

DROP POLICY IF EXISTS requests_insert ON public.requests;
CREATE POLICY requests_insert ON public.requests
  FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('requests.create'));

DROP POLICY IF EXISTS requests_update ON public.requests;
CREATE POLICY requests_update ON public.requests
  FOR UPDATE TO authenticated
  USING (public.has_permission('requests.review') OR public.has_permission('requests.process'))
  WITH CHECK (public.has_permission('requests.review') OR public.has_permission('requests.process'));

DROP POLICY IF EXISTS request_items_select ON public.request_items;
CREATE POLICY request_items_select ON public.request_items
  FOR SELECT TO authenticated
  USING (public.has_permission('requests.view'));

DROP POLICY IF EXISTS request_items_all ON public.request_items;
CREATE POLICY request_items_all ON public.request_items
  FOR ALL TO authenticated
  USING (public.has_permission('requests.create') OR public.has_permission('requests.review') OR public.has_permission('requests.process'))
  WITH CHECK (public.has_permission('requests.create') OR public.has_permission('requests.review') OR public.has_permission('requests.process'));

-- ---------- 6. RPC: kirim barang (buat transaksi OUT otomatis) ----------
-- Dipanggil saat admin gudang mengirim barang yang sudah diproses helper.
-- p_lines: JSON [{request_item_id, qty, resi}]
CREATE OR REPLACE FUNCTION public.ship_request_items(
  p_request_id uuid,
  p_location_id uuid,
  p_lines jsonb,
  p_notes text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_req_status text;
  v_txn_id uuid;
  v_line jsonb;
  v_ri_id uuid; v_qty numeric; v_resi text;
  v_item_id uuid; v_item_name text; v_approved numeric; v_shipped numeric;
  v_item_status text;
BEGIN
  IF NOT (public.has_permission('requests.review')) THEN
    RAISE EXCEPTION 'Tidak punya izin mengirim permintaan';
  END IF;

  SELECT status INTO v_req_status FROM public.requests WHERE id = p_request_id;
  IF v_req_status IS NULL THEN RAISE EXCEPTION 'Permintaan tidak ditemukan'; END IF;
  IF v_req_status NOT IN ('disetujui','disetujui_sebagian','diproses') THEN
    RAISE EXCEPTION 'Permintaan belum disetujui (status: %)', v_req_status;
  END IF;

  -- Buat header transaksi OUT.
  INSERT INTO public.inventory_transactions
    (type, status, source_location_id, notes, reference, requested_by)
  VALUES
    ('out', 'posted', p_location_id, p_notes,
     (SELECT 'REQ-KIRIM/' || request_number FROM public.requests WHERE id = p_request_id),
     auth.uid())
  RETURNING id INTO v_txn_id;

  -- Proses tiap baris.
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_ri_id := (v_line->>'request_item_id')::uuid;
    v_qty   := (v_line->>'qty')::numeric;
    v_resi  := NULLIF(v_line->>'resi','');

    SELECT item_id, qty_approved, qty_shipped, item_status
      INTO v_item_id, v_approved, v_shipped, v_item_status
      FROM public.request_items WHERE id = v_ri_id AND request_id = p_request_id;

    IF v_item_id IS NULL THEN RAISE EXCEPTION 'Item permintaan tidak valid'; END IF;
    IF v_approved IS NULL THEN RAISE EXCEPTION 'Item belum di-approve (id %)'; END IF;
    IF v_item_status NOT IN ('disetujui','siap','pending_sebagian') THEN
      RAISE EXCEPTION 'Item belum siap dikirim (status: %)', v_item_status;
    END IF;
    IF v_qty <= 0 OR v_qty > (v_approved - v_shipped) THEN
      RAISE EXCEPTION 'Qty kirim % melebihi sisa %', v_qty, (v_approved - v_shipped);
    END IF;

    SELECT name INTO v_item_name FROM public.inventory_items WHERE id = v_item_id;

    -- Baris transaksi OUT (memakai efek posted -> stok berkurang).
    INSERT INTO public.inventory_transaction_items
      (transaction_id, item_id, qty, notes, resi)
    VALUES
      (v_txn_id, v_item_id, v_qty,
       'Kirim permintaan ' || (SELECT request_number FROM public.requests WHERE id = p_request_id),
       v_resi);

    -- Update item permintaan.
    UPDATE public.request_items
    SET qty_shipped = qty_shipped + v_qty,
        resi = COALESCE(v_resi, resi),
        item_status = CASE
          WHEN qty_shipped + v_qty >= qty_approved THEN 'terkirim'
          ELSE 'pending_sebagian'
        END,
        updated_at = now()
    WHERE id = v_ri_id;
  END LOOP;

  -- Terapkan efek stok.
  PERFORM public._apply_posted_effects(v_txn_id);

  -- Update status header request.
  UPDATE public.requests SET status = CASE
      WHEN NOT EXISTS (SELECT 1 FROM public.request_items
                       WHERE request_id = p_request_id
                         AND item_status NOT IN ('terkirim','ditolak')) THEN 'selesai'
      WHEN EXISTS (SELECT 1 FROM public.request_items
                   WHERE request_id = p_request_id AND item_status = 'pending_sebagian') THEN 'disetujui_sebagian'
      ELSE 'diproses'
    END,
    updated_at = now()
  WHERE id = p_request_id;

  RETURN v_txn_id;
END $$;
