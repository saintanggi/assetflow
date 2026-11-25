// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Tes integrasi PostgreSQL (PGlite) untuk migrasi
 * `20261126000001_audit_p0_security_and_data_fixes.sql`.
 *
 * Memverifikasi semua perbaikan P0/P1 pada engine database asli:
 *  1. Idempotensi migrasi (aman dijalankan ulang).
 *  2. GRANT EXECUTE & perilaku `receive_purchase_order` + `create_purchase_order`.
 *  3. `cancel_pending_request_item` menjaga baris `qty_shipped > 0` & hitung ulang status request.
 *  4. `admin_change_request_item` bebas tabrakan idempotency key lintas tiket.
 *  5. `void_inventory_transaction` memblokir `REQ-KIRIM/%` & `PO/%` dan menulis snapshot ke `audit_logs`.
 *  6. `split_request_item` atomik memecah qty N menjadi N baris @ qty 1.
 *  7. `finalize_stock_count` tidak membuat transaksi OPN kosong saat selisih 0.
 *  8. Maker-Checker trigger mencegah `helper` memodifikasi `qty_approved`/`qty_shipped` langsung.
 *  9. `get_nav_queue_counts()`, `get_dead_stock()`, dan advisory lock `try_lock_sheet_sync()`.
 */

const migrationSql = readFileSync(
  new URL(
    "../../supabase/migrations/20261126000001_audit_p0_security_and_data_fixes.sql",
    import.meta.url
  ),
  "utf8"
);

const UID_SUPER = "11111111-1111-1111-1111-111111111111";
const UID_HELPER = "22222222-2222-2222-2222-222222222222";
const UID_GUDANG = "33333333-3333-3333-3333-333333333333";

const WH_MAIN = "00000000-0000-0000-0000-0000000000a1";
const LOC_BARU = "00000000-0000-0000-0000-0000000000b1";
const LOC_RETUR = "00000000-0000-0000-0000-0000000000b2";
const LOC_UNREADY = "00000000-0000-0000-0000-0000000000b3";
const SUP_1 = "00000000-0000-0000-0000-0000000000d1";
const ITEM_A = "00000000-0000-0000-0000-0000000000c1";
const ITEM_B = "00000000-0000-0000-0000-0000000000c2";
const ITEM_DEC = "00000000-0000-0000-0000-0000000000c3";

let db: PGlite;

async function setActor(uid: string, role: "super_admin" | "admin_gudang" | "helper") {
  await db.query(`SELECT set_config('test.uid', $1, false)`, [uid]);
  await db.query(`SELECT set_config('test.role', $1, false)`, [role]);
}

describe("audit P0 security & data integrity fixes (PostgreSQL/PGlite)", () => {
  beforeAll(async () => {
    db = new PGlite();

    // Bootstrap minimal schema yang merepresentasikan produksi AssetFlow sebelum migrasi baru.
    await db.exec(`
      CREATE SCHEMA IF NOT EXISTS extensions;
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE SCHEMA IF NOT EXISTS storage;

      DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
      GRANT USAGE ON SCHEMA auth TO authenticated;
      GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

      CREATE FUNCTION public.is_service_role() RETURNS boolean LANGUAGE sql STABLE AS
        $$ SELECT COALESCE(current_setting('test.service', true), '') = 'true' $$;

      CREATE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql STABLE AS
        $$ SELECT COALESCE(current_setting('test.role', true), '') = 'super_admin' $$;

      CREATE FUNCTION public.is_staff() RETURNS boolean LANGUAGE sql STABLE AS
        $$ SELECT COALESCE(current_setting('test.role', true), '') IN ('super_admin', 'admin_gudang', 'admin_ho', 'helper') $$;

      CREATE FUNCTION public.has_permission(p_code text) RETURNS boolean LANGUAGE sql STABLE AS $$
        SELECT CASE COALESCE(current_setting('test.role', true), '')
          WHEN 'super_admin' THEN true
          WHEN 'admin_gudang' THEN p_code IN (
            'requests.view','requests.create','requests.review','requests.approve',
            'inventory.view','inventory.receive','inventory.issue','inventory.transfer','inventory.adjust'
          )
          WHEN 'helper' THEN p_code IN ('requests.view','requests.process','inventory.view')
          ELSE false
        END
      $$;

      -- Stub tabel storage untuk policy bucket surat-jalan.
      CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean);
      CREATE TABLE storage.objects (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        bucket_id text,
        name text
      );

      -- Tabel master & operasional.
      CREATE TABLE public.warehouses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, is_active boolean DEFAULT true);
      CREATE TABLE public.locations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        warehouse_id uuid REFERENCES public.warehouses(id),
        code text UNIQUE NOT NULL,
        name text NOT NULL,
        is_active boolean DEFAULT true
      );
      CREATE TABLE public.suppliers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, is_active boolean DEFAULT true);
      CREATE TABLE public.units (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text UNIQUE NOT NULL, allow_decimal boolean DEFAULT false);
      CREATE TABLE public.inventory_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        sku text UNIQUE NOT NULL,
        name text NOT NULL,
        brand text,
        unit_id uuid REFERENCES public.units(id),
        min_stock numeric(14,3) DEFAULT 0,
        purchase_price numeric(14,2) DEFAULT 0,
        is_active boolean DEFAULT true
      );
      CREATE TABLE public.inventory_balances (
        item_id uuid NOT NULL REFERENCES public.inventory_items(id),
        location_id uuid NOT NULL REFERENCES public.locations(id),
        qty numeric(14,3) NOT NULL DEFAULT 0,
        updated_at timestamptz DEFAULT now(),
        PRIMARY KEY (item_id, location_id)
      );

      CREATE SEQUENCE public.doc_seq START 1;
      CREATE FUNCTION public.next_doc_number(p_prefix text) RETURNS text LANGUAGE sql AS $$
        SELECT p_prefix || '-' || to_char(CURRENT_DATE, 'YYYYMM') || '-' || lpad(nextval('public.doc_seq')::text, 4, '0')
      $$;

      CREATE TABLE public.inventory_transactions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        doc_number text UNIQUE,
        type text NOT NULL,
        status text NOT NULL DEFAULT 'draft',
        transaction_date date NOT NULL DEFAULT CURRENT_DATE,
        source_location_id uuid REFERENCES public.locations(id),
        dest_location_id uuid REFERENCES public.locations(id),
        reference text,
        notes text,
        surat_jalan_url text,
        idempotency_key text UNIQUE,
        created_by uuid,
        posted_at timestamptz,
        reversed_at timestamptz,
        reversal_of uuid REFERENCES public.inventory_transactions(id) ON DELETE RESTRICT,
        reversal_reason text,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );
      CREATE FUNCTION public.trg_set_doc_number() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.doc_number IS NULL THEN
          NEW.doc_number := public.next_doc_number(upper(NEW.type));
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER set_doc_num BEFORE INSERT ON public.inventory_transactions
        FOR EACH ROW EXECUTE FUNCTION public.trg_set_doc_number();

      CREATE TABLE public.inventory_transaction_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        transaction_id uuid NOT NULL REFERENCES public.inventory_transactions(id) ON DELETE CASCADE,
        item_id uuid NOT NULL REFERENCES public.inventory_items(id),
        qty numeric(14,3) NOT NULL,
        unit_price numeric(15,2),
        notes text,
        resi text,
        gerai text,
        status_aset text,
        updated_at timestamptz DEFAULT now()
      );

      CREATE TABLE public.inventory_ledger (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        transaction_id uuid NOT NULL REFERENCES public.inventory_transactions(id) ON DELETE CASCADE,
        item_id uuid NOT NULL REFERENCES public.inventory_items(id),
        location_id uuid NOT NULL REFERENCES public.locations(id),
        qty_change numeric(14,3) NOT NULL,
        qty_after numeric(14,3) NOT NULL,
        created_at timestamptz DEFAULT now()
      );

      CREATE FUNCTION public._change_balance(
        p_item_id uuid,
        p_location_id uuid,
        p_delta numeric,
        p_txn_id uuid,
        p_allow_negative boolean DEFAULT false
      ) RETURNS numeric LANGUAGE plpgsql AS $$
      DECLARE
        v_cur numeric;
        v_next numeric;
      BEGIN
        SELECT COALESCE(qty, 0) INTO v_cur FROM public.inventory_balances
         WHERE item_id = p_item_id AND location_id = p_location_id;
        v_next := COALESCE(v_cur, 0) + p_delta;
        IF NOT p_allow_negative AND v_next < 0 THEN
          RAISE EXCEPTION 'Stok tidak mencukupi';
        END IF;
        INSERT INTO public.inventory_balances (item_id, location_id, qty)
        VALUES (p_item_id, p_location_id, v_next)
        ON CONFLICT (item_id, location_id) DO UPDATE SET qty = EXCLUDED.qty, updated_at = now();
        INSERT INTO public.inventory_ledger (transaction_id, item_id, location_id, qty_change, qty_after)
        VALUES (p_txn_id, p_item_id, p_location_id, p_delta, v_next);
        RETURN v_next;
      END;
      $$;

      CREATE FUNCTION public._apply_posted_effects(p_txn_id uuid, p_allow_negative boolean DEFAULT false)
      RETURNS void LANGUAGE plpgsql AS $$
      DECLARE
        v_txn record;
        v_line record;
        v_cur numeric;
        v_next numeric;
      BEGIN
        SELECT * INTO v_txn FROM public.inventory_transactions WHERE id = p_txn_id;
        FOR v_line IN SELECT * FROM public.inventory_transaction_items WHERE transaction_id = p_txn_id LOOP
          IF v_txn.type = 'in' THEN
            INSERT INTO public.inventory_balances (item_id, location_id, qty)
            VALUES (v_line.item_id, v_txn.dest_location_id, v_line.qty)
            ON CONFLICT (item_id, location_id) DO UPDATE SET qty = public.inventory_balances.qty + EXCLUDED.qty
            RETURNING qty INTO v_next;
            INSERT INTO public.inventory_ledger (transaction_id, item_id, location_id, qty_change, qty_after)
            VALUES (p_txn_id, v_line.item_id, v_txn.dest_location_id, v_line.qty, v_next);
          ELSIF v_txn.type = 'out' THEN
            SELECT COALESCE(qty, 0) INTO v_cur FROM public.inventory_balances
             WHERE item_id = v_line.item_id AND location_id = v_txn.source_location_id;
            v_next := COALESCE(v_cur, 0) - v_line.qty;
            IF NOT p_allow_negative AND v_next < 0 THEN
              RAISE EXCEPTION 'Stok tidak mencukupi';
            END IF;
            INSERT INTO public.inventory_balances (item_id, location_id, qty)
            VALUES (v_line.item_id, v_txn.source_location_id, v_next)
            ON CONFLICT (item_id, location_id) DO UPDATE SET qty = EXCLUDED.qty;
            INSERT INTO public.inventory_ledger (transaction_id, item_id, location_id, qty_change, qty_after)
            VALUES (p_txn_id, v_line.item_id, v_txn.source_location_id, -v_line.qty, v_next);
          ELSIF v_txn.type = 'adjust' THEN
            INSERT INTO public.inventory_balances (item_id, location_id, qty)
            VALUES (v_line.item_id, v_txn.dest_location_id, v_line.qty)
            ON CONFLICT (item_id, location_id) DO UPDATE SET qty = public.inventory_balances.qty + EXCLUDED.qty
            RETURNING qty INTO v_next;
            INSERT INTO public.inventory_ledger (transaction_id, item_id, location_id, qty_change, qty_after)
            VALUES (p_txn_id, v_line.item_id, v_txn.dest_location_id, v_line.qty, v_next);
          END IF;
        END LOOP;
      END;
      $$;

      CREATE TABLE public.requests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        request_number text NOT NULL,
        ticket_no text,
        branch_name text,
        status text NOT NULL DEFAULT 'diajukan',
        request_date date DEFAULT CURRENT_DATE,
        approved_by uuid,
        approved_at timestamptz,
        review_notes text,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );
      CREATE TABLE public.request_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        request_id uuid NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
        item_id uuid NOT NULL REFERENCES public.inventory_items(id),
        qty_requested numeric(14,3) NOT NULL,
        qty_approved numeric(14,3),
        qty_shipped numeric(14,3) DEFAULT 0,
        barcode text,
        serial_number text,
        resi text,
        item_type text,
        status_aset text DEFAULT 'ASSET BARU',
        item_status text NOT NULL DEFAULT 'menunggu',
        notes text,
        updated_at timestamptz DEFAULT now()
      );

      CREATE TABLE public.purchase_orders (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        po_number text UNIQUE NOT NULL,
        supplier_id uuid REFERENCES public.suppliers(id),
        status text NOT NULL DEFAULT 'draft',
        order_date date NOT NULL DEFAULT CURRENT_DATE,
        expected_date date,
        total_amount numeric(14,2) DEFAULT 0,
        notes text,
        created_by uuid,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );
      CREATE TABLE public.purchase_order_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        po_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
        item_id uuid NOT NULL REFERENCES public.inventory_items(id),
        qty_ordered numeric(14,3) NOT NULL,
        qty_received numeric(14,3) NOT NULL DEFAULT 0,
        unit_price numeric(14,2) DEFAULT 0
      );

      CREATE TABLE public.stock_counts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        doc_number text UNIQUE NOT NULL,
        location_id uuid NOT NULL REFERENCES public.locations(id),
        status text NOT NULL DEFAULT 'draft',
        notes text,
        counted_by uuid,
        posted_at timestamptz,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );
      CREATE TABLE public.stock_count_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        stock_count_id uuid NOT NULL REFERENCES public.stock_counts(id) ON DELETE CASCADE,
        item_id uuid NOT NULL REFERENCES public.inventory_items(id),
        system_qty numeric(14,3) NOT NULL,
        counted_qty numeric(14,3) NOT NULL
      );

      CREATE TABLE public.audit_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_id uuid,
        action text NOT NULL,
        entity_type text NOT NULL,
        entity_id text,
        old_data jsonb,
        new_data jsonb,
        created_at timestamptz DEFAULT now()
      );
      CREATE FUNCTION public.log_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
      BEGIN
        INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, old_data, new_data)
        VALUES (
          auth.uid(),
          TG_OP,
          TG_TABLE_NAME,
          COALESCE((CASE WHEN TG_OP = 'DELETE' THEN OLD.id::text ELSE NEW.id::text END), ''),
          CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
          CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END
        );
        RETURN COALESCE(NEW, OLD);
      END;
      $$;

      CREATE TABLE public.user_accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), username text UNIQUE, role text, is_active boolean DEFAULT true);
      CREATE TABLE public.role_permissions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), role_id uuid, permission_id uuid);
      CREATE TABLE public.user_permissions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, permission_id uuid, granted boolean);
      CREATE TABLE public.sheet_sync_runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text);
      CREATE VIEW public.v_sheet_sync_recent AS SELECT * FROM public.sheet_sync_runs;

      -- Seed master data.
      INSERT INTO public.warehouses (id, name) VALUES ('${WH_MAIN}', 'Gudang Utama');
      INSERT INTO public.locations (id, warehouse_id, code, name) VALUES
        ('${LOC_BARU}', '${WH_MAIN}', 'STOK-BARU', 'Gudang Asset Baru'),
        ('${LOC_RETUR}', '${WH_MAIN}', 'STOK-RETUR', 'Gudang Asset Retur'),
        ('${LOC_UNREADY}', '${WH_MAIN}', 'STOK-UNREADY', 'Gudang Asset Unready');
      INSERT INTO public.suppliers (id, name) VALUES ('${SUP_1}', 'PT Pemasok Utama');
      INSERT INTO public.units (id, code, allow_decimal) VALUES
        ('00000000-0000-0000-0000-0000000000e1', 'PCS', false),
        ('00000000-0000-0000-0000-0000000000e2', 'KG', true);
      INSERT INTO public.inventory_items (id, sku, name, unit_id, min_stock, purchase_price) VALUES
        ('${ITEM_A}', 'SKU-A', 'Router Mikrotik', '00000000-0000-0000-0000-0000000000e1', 5, 500000),
        ('${ITEM_B}', 'SKU-B', 'Switch 8 Port', '00000000-0000-0000-0000-0000000000e1', 5, 300000),
        ('${ITEM_DEC}', 'SKU-DEC', 'Kabel Roll', '00000000-0000-0000-0000-0000000000e2', 0, 10000);
      INSERT INTO public.inventory_balances (item_id, location_id, qty) VALUES
        ('${ITEM_A}', '${LOC_BARU}', 10),
        ('${ITEM_B}', '${LOC_BARU}', 10),
        ('${ITEM_A}', '${LOC_RETUR}', 100);
    `);

    // Jalankan migrasi P0 (pertama kali).
    await db.exec(migrationSql);
  });

  afterAll(async () => {
    await db.close();
  });

  it("1. migrasi bersifat idempoten (aman dijalankan ulang tanpa error)", async () => {
    await expect(db.exec(migrationSql)).resolves.not.toThrow();
  });

  it("2. create_purchase_order & receive_purchase_order: GRANT, validasi status draft, posted, idempoten, allow_decimal", async () => {
    // Cek GRANT EXECUTE ke role authenticated.
    const grantCheck = await db.query<{ can_exec: boolean }>(
      `SELECT has_function_privilege('authenticated', 'public.receive_purchase_order(uuid, jsonb, uuid, text, date)', 'EXECUTE') AS can_exec`
    );
    expect(grantCheck.rows[0].can_exec).toBe(true);

    // Helper tidak boleh buat / terima PO.
    await setActor(UID_HELPER, "helper");
    await expect(
      db.query(
        `SELECT public.create_purchase_order($1, 'draft', CURRENT_DATE, NULL, NULL, $2::jsonb)`,
        [SUP_1, JSON.stringify([{ item_id: ITEM_A, qty_ordered: 5, unit_price: 500000 }])]
      )
    ).rejects.toThrow(/izin/i);

    // Admin Gudang buat PO draft — tidak boleh langsung diterima.
    await setActor(UID_GUDANG, "admin_gudang");
    const draftRes = await db.query<{ res: { id: string; po_number: string } }>(
      `SELECT public.create_purchase_order($1, 'draft', CURRENT_DATE, NULL, 'Draft PO', $2::jsonb) AS res`,
      [SUP_1, JSON.stringify([{ item_id: ITEM_A, qty_ordered: 5, unit_price: 500000 }])]
    );
    const poId = draftRes.rows[0].res.id;
    expect(draftRes.rows[0].res.po_number).toMatch(/^PO-/);

    const poItemRes = await db.query<{ id: string }>(
      `SELECT id FROM public.purchase_order_items WHERE po_id = $1`,
      [poId]
    );
    const poItemId = poItemRes.rows[0].id;

    // Draft PO harus ditolak oleh receive_purchase_order.
    await expect(
      db.query(
        `SELECT public.receive_purchase_order($1, $2::jsonb, $3, 'idem-po-1', NULL)`,
        [poId, JSON.stringify([{ po_item_id: poItemId, qty: 2 }]), LOC_BARU]
      )
    ).rejects.toThrow(/draft/i);

    // Ubah PO ke ordered.
    await db.query(`UPDATE public.purchase_orders SET status = 'ordered' WHERE id = $1`, [poId]);

    // Item PCS (allow_decimal=false) harus menolak qty desimal 1.5.
    await expect(
      db.query(
        `SELECT public.receive_purchase_order($1, $2::jsonb, $3, 'idem-po-dec', NULL)`,
        [poId, JSON.stringify([{ po_item_id: poItemId, qty: 1.5 }]), LOC_BARU]
      )
    ).rejects.toThrow(/bilangan bulat/i);

    // Terima 3 unit — harus membuat transaksi status='posted' & posted_at IS NOT NULL.
    const doc1 = (
      await db.query<{ doc: string }>(
        `SELECT public.receive_purchase_order($1, $2::jsonb, $3, 'idem-po-ok', NULL) AS doc`,
        [poId, JSON.stringify([{ po_item_id: poItemId, qty: 3 }]), LOC_BARU]
      )
    ).rows[0].doc;
    expect(doc1).toMatch(/^IN-/);

    const txn = (
      await db.query<{ status: string; posted_at: string | null }>(
        `SELECT status, posted_at FROM public.inventory_transactions WHERE doc_number = $1`,
        [doc1]
      )
    ).rows[0];
    expect(txn.status).toBe("posted");
    expect(txn.posted_at).not.toBeNull();

    // Retry dengan idempotency key sama tidak boleh menggandakan stok!
    const doc2 = (
      await db.query<{ doc: string }>(
        `SELECT public.receive_purchase_order($1, $2::jsonb, $3, 'idem-po-ok', NULL) AS doc`,
        [poId, JSON.stringify([{ po_item_id: poItemId, qty: 3 }]), LOC_BARU]
      )
    ).rows[0].doc;
    expect(doc2).toBe(doc1);

    const bal = (
      await db.query<{ qty: string }>(
        `SELECT qty FROM public.inventory_balances WHERE item_id = $1 AND location_id = $2`,
        [ITEM_A, LOC_BARU]
      )
    ).rows[0];
    expect(Number(bal.qty)).toBe(13); // 10 awal + 3 diterima (bukan 16!)
  });

  it("3. cancel_pending_request_item mempertahankan baris qty_shipped > 0 & menghitung ulang status request", async () => {
    await setActor(UID_SUPER, "super_admin");
    const reqId = (
      await db.query<{ id: string }>(
        `INSERT INTO public.requests (request_number, ticket_no, status)
         VALUES ('REQ-TEST-1', 'TKT-PARTIAL', 'disetujui_sebagian') RETURNING id`
      )
    ).rows[0].id;
    const riId = (
      await db.query<{ id: string }>(
        `INSERT INTO public.request_items (request_id, item_id, qty_requested, qty_approved, qty_shipped, item_status)
         VALUES ($1, $2, 5, 5, 2, 'pending_sebagian') RETURNING id`,
        [reqId, ITEM_A]
      )
    ).rows[0].id;

    const res = (
      await db.query<{ r: { closed_partial: boolean; request_deleted: boolean; status: string } }>(
        `SELECT public.cancel_pending_request_item($1) AS r`,
        [riId]
      )
    ).rows[0].r;
    expect(res.closed_partial).toBe(true);
    expect(res.request_deleted).toBe(false);
    expect(res.status).toBe("selesai");

    const riAfter = (
      await db.query<{ qty_approved: string; qty_shipped: string; item_status: string }>(
        `SELECT qty_approved, qty_shipped, item_status FROM public.request_items WHERE id = $1`,
        [riId]
      )
    ).rows[0];
    expect(Number(riAfter.qty_approved)).toBe(2);
    expect(Number(riAfter.qty_shipped)).toBe(2);
    expect(riAfter.item_status).toBe("terkirim");

    const reqAfter = (
      await db.query<{ status: string }>(`SELECT status FROM public.requests WHERE id = $1`, [reqId])
    ).rows[0];
    expect(reqAfter.status).toBe("selesai");
  });

  it("4. admin_change_request_item bebas tabrakan idempotency key pada 2 tiket berbeda dengan item/qty sama", async () => {
    await setActor(UID_SUPER, "super_admin");
    const req1 = (
      await db.query<{ id: string }>(
        `INSERT INTO public.requests (request_number, ticket_no, status) VALUES ('REQ-C1', 'TKT-C1', 'selesai') RETURNING id`
      )
    ).rows[0].id;
    const req2 = (
      await db.query<{ id: string }>(
        `INSERT INTO public.requests (request_number, ticket_no, status) VALUES ('REQ-C2', 'TKT-C2', 'selesai') RETURNING id`
      )
    ).rows[0].id;
    const ri1 = (
      await db.query<{ id: string }>(
        `INSERT INTO public.request_items (request_id, item_id, qty_requested, qty_approved, qty_shipped, status_aset, item_status)
         VALUES ($1, $2, 2, 2, 2, 'ASSET BARU', 'terkirim') RETURNING id`,
        [req1, ITEM_A]
      )
    ).rows[0].id;
    const ri2 = (
      await db.query<{ id: string }>(
        `INSERT INTO public.request_items (request_id, item_id, qty_requested, qty_approved, qty_shipped, status_aset, item_status)
         VALUES ($1, $2, 2, 2, 2, 'ASSET BARU', 'terkirim') RETURNING id`,
        [req2, ITEM_A]
      )
    ).rows[0].id;

    const beforeB = Number(
      (
        await db.query<{ qty: string }>(
          `SELECT qty FROM public.inventory_balances WHERE item_id = $1 AND location_id = $2`,
          [ITEM_B, LOC_BARU]
        )
      ).rows[0].qty
    );

    const r1 = (
      await db.query<{ r: { ok: boolean; stock_move: { moved: boolean; out_doc: string } } }>(
        `SELECT public.admin_change_request_item($1, $2, 'ASSET BARU', 'Salah item 1') AS r`,
        [ri1, ITEM_B]
      )
    ).rows[0].r;
    const r2 = (
      await db.query<{ r: { ok: boolean; stock_move: { moved: boolean; out_doc: string } } }>(
        `SELECT public.admin_change_request_item($1, $2, 'ASSET BARU', 'Salah item 2') AS r`,
        [ri2, ITEM_B]
      )
    ).rows[0].r;

    expect(r1.ok).toBe(true);
    expect(r1.stock_move.moved).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r2.stock_move.moved).toBe(true);
    expect(r1.stock_move.out_doc).not.toBe(r2.stock_move.out_doc);

    const afterB = Number(
      (
        await db.query<{ qty: string }>(
          `SELECT qty FROM public.inventory_balances WHERE item_id = $1 AND location_id = $2`,
          [ITEM_B, LOC_BARU]
        )
      ).rows[0].qty
    );
    expect(afterB).toBe(beforeB - 4); // Kedua tiket benar-benar memotong stok ITEM_B (2 + 2)
  });

  it("5. void_inventory_transaction memblokir transaksi sistem & mencatat snapshot audit_logs", async () => {
    await setActor(UID_SUPER, "super_admin");
    // Transaksi REQ-KIRIM harus ditolak.
    const reqTxn = (
      await db.query<{ id: string }>(
        `INSERT INTO public.inventory_transactions (type, status, reference, dest_location_id, posted_at)
         VALUES ('in', 'posted', 'REQ-KIRIM/REQ-001', $1, now()) RETURNING id`,
        [LOC_BARU]
      )
    ).rows[0].id;
    await expect(
      db.query(`SELECT public.void_inventory_transaction($1)`, [reqTxn])
    ).rejects.toThrow(/pengiriman permintaan/i);

    // Transaksi manual biasa boleh di-void dan menulis snapshot ke audit_logs.
    const manualTxn = (
      await db.query<{ id: string }>(
        `INSERT INTO public.inventory_transactions (type, status, dest_location_id, notes, posted_at)
         VALUES ('in', 'posted', $1, 'Input manual salah', now()) RETURNING id`,
        [LOC_BARU]
      )
    ).rows[0].id;
    await db.query(
      `INSERT INTO public.inventory_transaction_items (transaction_id, item_id, qty) VALUES ($1, $2, 1)`,
      [manualTxn, ITEM_A]
    );
    await db.query(`SELECT public._apply_posted_effects($1, true)`, [manualTxn]);

    await db.query(`SELECT public.void_inventory_transaction($1)`, [manualTxn]);
    const audit = await db.query<{ action: string; old_data: { items: unknown[]; ledger: unknown[] } }>(
      `SELECT action, old_data FROM public.audit_logs WHERE entity_id = $1 AND action = 'VOID'`,
      [manualTxn]
    );
    expect(audit.rows.length).toBe(1);
    expect(audit.rows[0].old_data.items.length).toBe(1);
    expect(audit.rows[0].old_data.ledger.length).toBe(1);
  });

  it("6. split_request_item atomik memecah qty 3 menjadi 3 baris @ qty 1", async () => {
    await setActor(UID_SUPER, "super_admin");
    const reqId = (
      await db.query<{ id: string }>(
        `INSERT INTO public.requests (request_number, ticket_no, status) VALUES ('REQ-SPL', 'TKT-SPL', 'disetujui') RETURNING id`
      )
    ).rows[0].id;
    const riId = (
      await db.query<{ id: string }>(
        `INSERT INTO public.request_items (request_id, item_id, qty_requested, qty_approved, qty_shipped, barcode, serial_number, item_status)
         VALUES ($1, $2, 3, 3, 0, E'BC1\nBC2\nBC3', E'SN1\nSN2\nSN3', 'disetujui') RETURNING id`,
        [reqId, ITEM_A]
      )
    ).rows[0].id;

    const splitCount = (
      await db.query<{ n: number }>(`SELECT public.split_request_item($1) AS n`, [riId])
    ).rows[0].n;
    expect(splitCount).toBe(3);

    const rows = (
      await db.query<{ qty_approved: string; barcode: string }>(
        `SELECT qty_approved, barcode FROM public.request_items WHERE request_id = $1 ORDER BY barcode`,
        [reqId]
      )
    ).rows;
    expect(rows.map((r) => ({ qty: Number(r.qty_approved), bc: r.barcode }))).toEqual([
      { qty: 1, bc: "BC1" },
      { qty: 1, bc: "BC2" },
      { qty: 1, bc: "BC3" },
    ]);
  });

  it("7. finalize_stock_count melewati pembuatan dokumen OPN kosong jika selisih 0", async () => {
    await setActor(UID_GUDANG, "admin_gudang");
    const liveQty = Number(
      (
        await db.query<{ qty: string }>(
          `SELECT qty FROM public.inventory_balances WHERE item_id = $1 AND location_id = $2`,
          [ITEM_A, LOC_BARU]
        )
      ).rows[0].qty
    );
    const scId = (
      await db.query<{ id: string }>(
        `INSERT INTO public.stock_counts (doc_number, location_id, status) VALUES ('OPN-ZERO', $1, 'draft') RETURNING id`,
        [LOC_BARU]
      )
    ).rows[0].id;
    await db.query(
      `INSERT INTO public.stock_count_items (stock_count_id, item_id, system_qty, counted_qty) VALUES ($1, $2, $3, $3)`,
      [scId, ITEM_A, liveQty]
    );

    const txnBefore = Number(
      (await db.query<{ c: string }>(`SELECT count(*) AS c FROM public.inventory_transactions`)).rows[0].c
    );
    await db.query(`SELECT public.finalize_stock_count($1)`, [scId]);
    const txnAfter = Number(
      (await db.query<{ c: string }>(`SELECT count(*) AS c FROM public.inventory_transactions`)).rows[0].c
    );
    expect(txnAfter).toBe(txnBefore);

    const scStatus = (
      await db.query<{ status: string }>(`SELECT status FROM public.stock_counts WHERE id = $1`, [scId])
    ).rows[0].status;
    expect(scStatus).toBe("posted");
  });

  it("8. Maker-Checker trigger memblokir helper mengubah qty_approved langsung, tapi mengizinkan isi resi/barcode", async () => {
    await setActor(UID_SUPER, "super_admin");
    const reqId = (
      await db.query<{ id: string }>(
        `INSERT INTO public.requests (request_number, ticket_no, status) VALUES ('REQ-MC', 'TKT-MC', 'disetujui') RETURNING id`
      )
    ).rows[0].id;
    const riId = (
      await db.query<{ id: string }>(
        `INSERT INTO public.request_items (request_id, item_id, qty_requested, qty_approved, qty_shipped, item_status)
         VALUES ($1, $2, 2, 2, 0, 'disetujui') RETURNING id`,
        [reqId, ITEM_A]
      )
    ).rows[0].id;

    await db.exec(`GRANT USAGE ON SCHEMA public TO authenticated; GRANT SELECT, UPDATE ON public.request_items TO authenticated;`);
    await setActor(UID_HELPER, "helper");
    await db.exec(`SET ROLE authenticated`);
    try {
      // Helper boleh mengisi resi/barcode.
      await expect(
        db.query(`UPDATE public.request_items SET resi = 'JNE12345' WHERE id = $1`, [riId])
      ).resolves.not.toThrow();

      // Helper DILARANG mengubah qty_approved atau qty_shipped langsung!
      await expect(
        db.query(`UPDATE public.request_items SET qty_approved = 99 WHERE id = $1`, [riId])
      ).rejects.toThrow(/izin/i);
      await expect(
        db.query(`UPDATE public.request_items SET qty_shipped = 2 WHERE id = $1`, [riId])
      ).rejects.toThrow(/izin ditolak/i);
    } finally {
      await db.exec(`RESET ROLE`);
    }
  });

  it("9. get_nav_queue_counts hanya menghitung lokasi *-BARU & try_lock_sheet_sync berfungsi", async () => {
    await setActor(UID_GUDANG, "admin_gudang");
    // ITEM_A punya min_stock=5, saldo STOK-RETUR=100, kita set STOK-BARU=2 → harus terdeteksi low_stock!
    await db.query(
      `UPDATE public.inventory_balances SET qty = 2 WHERE item_id = $1 AND location_id = $2`,
      [ITEM_A, LOC_BARU]
    );
    const nav = (
      await db.query<{ c: { low_stock: number; diajukan: number } }>(
        `SELECT public.get_nav_queue_counts() AS c`
      )
    ).rows[0].c;
    expect(nav.low_stock).toBeGreaterThanOrEqual(1);

    const dead = await db.query<{ sku: string }>(`SELECT sku FROM public.get_dead_stock(90)`);
    expect(dead.rows.length).toBeGreaterThanOrEqual(1);

    const locked = (
      await db.query<{ ok: boolean }>(`SELECT public.try_lock_sheet_sync('sheet-sync:test') AS ok`)
    ).rows[0].ok;
    expect(locked).toBe(true);
    const unlocked = (
      await db.query<{ ok: boolean }>(`SELECT public.unlock_sheet_sync('sheet-sync:test') AS ok`)
    ).rows[0].ok;
    expect(unlocked).toBe(true);
  });
});
