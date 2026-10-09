-- =============================================================
-- AssetFlow — Migrasi 000001: Skema database
-- =============================================================
-- Urutan: 000001 schema -> 000002 rls -> 000003 functions -> 000004 seed
-- Dijalankan berurutan di Supabase SQL Editor (atau via supabase db push).
--
-- Konvensi (sesuai IMPLEMENTATION_PLAN.md):
--   * PK: id uuid default gen_random_uuid() — kecuali inventory_balances
--     yang memakai composite PK (item_id, location_id) sesuai kontrak.
--   * created_at/updated_at timestamptz default now() di semua tabel,
--     kecuali inventory_ledger & audit_logs yang append-only.
--   * Kolom tambahan di luar kontrak diberi komentar "tambahan:".
-- =============================================================

-- Ekstensi yang dibutuhkan (sudah tersedia di Supabase).
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =============================================================
-- Fungsi utilitas: isi updated_at otomatis
-- =============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- =============================================================
-- 1. ROLES & PERMISSIONS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.roles (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL UNIQUE,          -- 'super_admin' | 'admin'
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.permissions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text        NOT NULL UNIQUE,          -- cth 'assets.view'
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id       uuid        NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id uuid        NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_role_permissions UNIQUE (role_id, permission_id)
);

-- =============================================================
-- 2. PROFILES (id = auth.users.id)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id         uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      text        NOT NULL UNIQUE,
  full_name  text,
  role_id    uuid        REFERENCES public.roles(id) ON DELETE RESTRICT,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
  -- role_id boleh NULL: user baru belum punya role sampai ditetapkan
  -- oleh Super Admin (dibuat otomatis oleh trigger handle_new_user).
);

CREATE TABLE IF NOT EXISTS public.user_permissions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  permission_id uuid        NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  granted       boolean     NOT NULL DEFAULT true,  -- false = pencabutan eksplisit
  granted_by    uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  granted_at    timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_permissions UNIQUE (user_id, permission_id)
);

-- =============================================================
-- 3. MASTER DATA
-- =============================================================
CREATE TABLE IF NOT EXISTS public.asset_categories (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text        NOT NULL UNIQUE,
  name        text        NOT NULL,
  description text,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.warehouses (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text        NOT NULL UNIQUE,
  name       text        NOT NULL,
  address    text,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.locations (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid        NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  code         text        NOT NULL UNIQUE,
  name         text        NOT NULL,
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.units (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text        NOT NULL UNIQUE,      -- pcs, unit, box, pack, meter, liter, kg
  name          text        NOT NULL,
  allow_decimal boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.departments (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text        NOT NULL UNIQUE,
  name       text        NOT NULL,
  is_active  boolean     NOT NULL DEFAULT true,  -- tambahan: untuk penonaktifan
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.suppliers (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text        NOT NULL UNIQUE,
  name       text        NOT NULL,
  contact    text,
  phone      text,
  address    text,
  is_active  boolean     NOT NULL DEFAULT true,  -- tambahan: untuk penonaktifan
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- =============================================================
-- 4. ASET TETAP
-- =============================================================
CREATE TABLE IF NOT EXISTS public.assets (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_code    text          NOT NULL UNIQUE,
  public_code   text          UNIQUE,               -- diisi trigger bila NULL (untuk QR publik)
  name          text          NOT NULL,
  category_id   uuid          REFERENCES public.asset_categories(id) ON DELETE RESTRICT,
  brand         text,
  model         text,
  serial_number text,                              -- privat: tidak boleh ke endpoint publik
  purchase_date date,
  purchase_price numeric(15,2),                    -- privat
  location_id   uuid          REFERENCES public.locations(id) ON DELETE RESTRICT,
  department_id uuid          REFERENCES public.departments(id) ON DELETE SET NULL,
  custodian     text,                              -- penanggung jawab
  condition     text          NOT NULL DEFAULT 'baik',
  status        text          NOT NULL DEFAULT 'tersedia',
  photo_url     text,
  is_published  boolean       NOT NULL DEFAULT false,
  published_at  timestamptz,
  published_by  uuid          REFERENCES public.profiles(id) ON DELETE SET NULL,
  archived      boolean       NOT NULL DEFAULT false,
  created_by    uuid          REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT assets_condition_check CHECK (condition IN ('baik', 'rusak_ringan', 'rusak_berat')),
  CONSTRAINT assets_status_check CHECK (status IN ('tersedia', 'digunakan', 'dipinjamkan', 'perbaikan', 'rusak', 'dipensiunkan')),
  CONSTRAINT assets_price_check CHECK (purchase_price IS NULL OR purchase_price >= 0)
);

-- =============================================================
-- 5. PERSEDIAAN BARANG
-- =============================================================
CREATE TABLE IF NOT EXISTS public.inventory_items (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  sku            text          NOT NULL UNIQUE,
  name           text          NOT NULL,
  category_id    uuid          REFERENCES public.asset_categories(id) ON DELETE RESTRICT,
  brand          text,
  model          text,
  unit_id        uuid          NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
  barcode        text          UNIQUE,             -- default = sku (diisi trigger)
  min_stock      numeric(15,3) NOT NULL DEFAULT 0,
  location_id    uuid          REFERENCES public.locations(id) ON DELETE SET NULL,
  supplier_id    uuid          REFERENCES public.suppliers(id) ON DELETE SET NULL,
  purchase_price numeric(15,2),                    -- privat
  is_active      boolean       NOT NULL DEFAULT true,
  photo_url      text,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  updated_at     timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT items_min_stock_check CHECK (min_stock >= 0),
  CONSTRAINT items_price_check CHECK (purchase_price IS NULL OR purchase_price >= 0)
);

-- Saldo per (item, lokasi). Composite PK sekaligus unique constraint gabungan.
CREATE TABLE IF NOT EXISTS public.inventory_balances (
  item_id     uuid          NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  location_id uuid          NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  qty         numeric(15,3) NOT NULL DEFAULT 0,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  updated_at  timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT inventory_balances_pkey PRIMARY KEY (item_id, location_id),
  CONSTRAINT balances_qty_check CHECK (qty >= 0)
);

-- =============================================================
-- 6. TRANSAKSI GUDANG
-- =============================================================
CREATE TABLE IF NOT EXISTS public.inventory_transactions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_number         text        NOT NULL UNIQUE,  -- diisi trigger bila NULL
  type               text        NOT NULL,         -- in|out|transfer|adjust|opname|return
  status             text        NOT NULL DEFAULT 'draft',  -- draft|posted|reversed
  transaction_date   date        NOT NULL DEFAULT CURRENT_DATE,
  source_location_id uuid        REFERENCES public.locations(id) ON DELETE RESTRICT,
  dest_location_id   uuid        REFERENCES public.locations(id) ON DELETE RESTRICT,
  reference          text,
  notes              text,
  idempotency_key    text        UNIQUE,
  created_by         uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  posted_at          timestamptz,
  reversed_at        timestamptz,
  reversal_of        uuid        REFERENCES public.inventory_transactions(id) ON DELETE RESTRICT,
  reversal_reason    text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT txn_type_check CHECK (type IN ('in', 'out', 'transfer', 'adjust', 'opname', 'return')),
  CONSTRAINT txn_status_check CHECK (status IN ('draft', 'posted', 'reversed'))
);

CREATE TABLE IF NOT EXISTS public.inventory_transaction_items (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid          NOT NULL REFERENCES public.inventory_transactions(id) ON DELETE CASCADE,
  item_id        uuid          NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  qty            numeric(15,3) NOT NULL,
  unit_price     numeric(15,2),
  notes          text,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  updated_at     timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT uq_txn_item UNIQUE (transaction_id, item_id),
  CONSTRAINT txn_item_price_check CHECK (unit_price IS NULL OR unit_price >= 0)
);

-- Ledger: histori pergerakan stok, append-only (tanpa updated_at).
CREATE TABLE IF NOT EXISTS public.inventory_ledger (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid          NOT NULL REFERENCES public.inventory_transactions(id) ON DELETE RESTRICT,
  item_id        uuid          NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  location_id    uuid          NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  qty_change     numeric(15,3) NOT NULL,
  qty_after      numeric(15,3) NOT NULL,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT ledger_qty_after_check CHECK (qty_after >= 0)
);

-- =============================================================
-- 7. PERGERAKAN ASET, STOCK OPNAME, AUDIT, SETTINGS
-- =============================================================
CREATE TABLE IF NOT EXISTS public.asset_movements (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id         uuid        NOT NULL REFERENCES public.assets(id) ON DELETE RESTRICT,
  from_location_id uuid        REFERENCES public.locations(id) ON DELETE SET NULL,
  to_location_id   uuid        REFERENCES public.locations(id) ON DELETE SET NULL,
  from_status      text,
  to_status        text,
  moved_by         uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.stock_counts (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_number  text        NOT NULL UNIQUE,        -- diisi trigger bila NULL
  location_id uuid        NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  status      text        NOT NULL DEFAULT 'draft',  -- draft|posted
  counted_by  uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes       text,
  posted_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_count_status_check CHECK (status IN ('draft', 'posted'))
);

CREATE TABLE IF NOT EXISTS public.stock_count_items (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_count_id uuid          NOT NULL REFERENCES public.stock_counts(id) ON DELETE CASCADE,
  item_id        uuid          NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  system_qty     numeric(15,3) NOT NULL DEFAULT 0,
  counted_qty    numeric(15,3),                    -- NULL = belum dihitung
  created_at     timestamptz   NOT NULL DEFAULT now(),
  updated_at     timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT uq_count_item UNIQUE (stock_count_id, item_id)
);

-- Audit log: append-only (tanpa updated_at). Ditulis oleh trigger log_audit().
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  action      text        NOT NULL,                -- INSERT|UPDATE|DELETE
  entity_type text        NOT NULL,                -- nama tabel
  entity_id   text,
  old_data    jsonb,
  new_data    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.app_settings (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  key        text        NOT NULL UNIQUE,
  value      jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- =============================================================
-- INDEX untuk pencarian & join
-- =============================================================
CREATE INDEX IF NOT EXISTS idx_profiles_role        ON public.profiles(role_id);
CREATE INDEX IF NOT EXISTS idx_profiles_email       ON public.profiles(email);

CREATE INDEX IF NOT EXISTS idx_assets_name_trgm     ON public.assets USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_assets_category      ON public.assets(category_id);
CREATE INDEX IF NOT EXISTS idx_assets_location     ON public.assets(location_id);
CREATE INDEX IF NOT EXISTS idx_assets_department   ON public.assets(department_id);
CREATE INDEX IF NOT EXISTS idx_assets_status       ON public.assets(status);
CREATE INDEX IF NOT EXISTS idx_assets_published    ON public.assets(is_published) WHERE is_published;
CREATE INDEX IF NOT EXISTS idx_assets_created       ON public.assets(created_at);

CREATE INDEX IF NOT EXISTS idx_items_name_trgm      ON public.inventory_items USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_items_category      ON public.inventory_items(category_id);
CREATE INDEX IF NOT EXISTS idx_items_unit          ON public.inventory_items(unit_id);
CREATE INDEX IF NOT EXISTS idx_items_supplier      ON public.inventory_items(supplier_id);

CREATE INDEX IF NOT EXISTS idx_txn_type_status     ON public.inventory_transactions(type, status);
CREATE INDEX IF NOT EXISTS idx_txn_date            ON public.inventory_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_txn_created         ON public.inventory_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_txn_created_by      ON public.inventory_transactions(created_by);
CREATE INDEX IF NOT EXISTS idx_txn_items_txn       ON public.inventory_transaction_items(transaction_id);
CREATE INDEX IF NOT EXISTS idx_txn_items_item      ON public.inventory_transaction_items(item_id);

CREATE INDEX IF NOT EXISTS idx_ledger_item_loc     ON public.inventory_ledger(item_id, location_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ledger_txn          ON public.inventory_ledger(transaction_id);

CREATE INDEX IF NOT EXISTS idx_movements_asset     ON public.asset_movements(asset_id);
CREATE INDEX IF NOT EXISTS idx_movements_created   ON public.asset_movements(created_at);

CREATE INDEX IF NOT EXISTS idx_counts_location     ON public.stock_counts(location_id);
CREATE INDEX IF NOT EXISTS idx_counts_status       ON public.stock_counts(status);
CREATE INDEX IF NOT EXISTS idx_count_items_count   ON public.stock_count_items(stock_count_id);
CREATE INDEX IF NOT EXISTS idx_count_items_item    ON public.stock_count_items(item_id);

CREATE INDEX IF NOT EXISTS idx_audit_entity        ON public.audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor         ON public.audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_created       ON public.audit_logs(created_at);

CREATE INDEX IF NOT EXISTS idx_locations_warehouse ON public.locations(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_user_perms_perm     ON public.user_permissions(permission_id);
CREATE INDEX IF NOT EXISTS idx_role_perms_role     ON public.role_permissions(role_id);

-- =============================================================
-- Trigger updated_at otomatis (satu fungsi, satu trigger per tabel)
-- =============================================================
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'roles','permissions','role_permissions','profiles','user_permissions',
    'asset_categories','warehouses','locations','units','departments','suppliers',
    'assets','inventory_items','inventory_balances',
    'inventory_transactions','inventory_transaction_items',
    'asset_movements','stock_counts','stock_count_items','app_settings'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t, t);
  END LOOP;
END
$$;
