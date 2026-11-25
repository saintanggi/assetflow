// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Tes integritas mesin laporan stok (PostgreSQL/PGlite).
 *
 * Yang dijaga:
 *  1. Stok Awal + IN - OUT = Stok Akhir untuk periode apa pun, termasuk
 *     transaksi bertanggal lampau (tanggal dokumen, bukan waktu posting).
 *  2. Stok Akhir periode lampau = saldo pada akhir periode itu, bukan saldo
 *     hari ini.
 *  3. Selisih historis (saldo != stok awal dasar + ledger) terdeteksi dan
 *     bisa diselaraskan tanpa mengubah stok fisik.
 */

const migration = readFileSync(
  new URL("../../supabase/migrations/20261125000001_stock_consistency.sql", import.meta.url),
  "utf8"
);

const WH = "00000000-0000-0000-0000-0000000000a0";
const LOC_BARU = "00000000-0000-0000-0000-0000000000b1";
const LOC_RETUR = "00000000-0000-0000-0000-0000000000b2";
const ITEM_A = "00000000-0000-0000-0000-0000000000c1";
const ITEM_B = "00000000-0000-0000-0000-0000000000c2";

let db: PGlite;

/** Buat transaksi 1 baris ledger untuk sebuah item/lokasi. */
async function movement(opts: {
  itemId: string;
  locationId: string;
  qty: number;
  date: string;
}): Promise<void> {
  const txn = (
    await db.query<{ id: string }>(
      `INSERT INTO public.inventory_transactions (transaction_date)
       VALUES ($1) RETURNING id`,
      [opts.date]
    )
  ).rows[0].id;
  await db.query(
    `INSERT INTO public.inventory_ledger
       (transaction_id, item_id, location_id, qty_change, qty_after)
     VALUES ($1, $2, $3, $4, $4)`,
    [txn, opts.itemId, opts.locationId, opts.qty]
  );
}

async function report(start: string, end: string, locs: string[] | null = null) {
  const res = await db.query<{
    item_id: string;
    location_id: string;
    opening_qty: string;
    total_in: string;
    total_out: string;
    closing_qty: string;
    balance_qty: string;
    opening_baseline: string;
    reconciled: boolean;
  }>(
    `SELECT * FROM public.stock_period_report($1::uuid[], $2::date, $3::date)`,
    [locs, start, end]
  );
  return res.rows.map((r) => ({
    ...r,
    opening_qty: Number(r.opening_qty),
    total_in: Number(r.total_in),
    total_out: Number(r.total_out),
    closing_qty: Number(r.closing_qty),
    balance_qty: Number(r.balance_qty),
    opening_baseline: Number(r.opening_baseline),
  }));
}

describe("laporan stok per periode (PostgreSQL/PGlite)", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;

      CREATE TABLE public.warehouses(id uuid PRIMARY KEY, name text);
      CREATE TABLE public.locations(
        id uuid PRIMARY KEY,
        warehouse_id uuid REFERENCES public.warehouses(id),
        code text UNIQUE,
        name text
      );
      CREATE TABLE public.inventory_items(
        id uuid PRIMARY KEY, sku text, name text
      );
      CREATE TABLE public.inventory_balances(
        item_id uuid REFERENCES public.inventory_items(id),
        location_id uuid REFERENCES public.locations(id),
        qty numeric(15,3) NOT NULL DEFAULT 0,
        opening_qty numeric(15,3) NOT NULL DEFAULT 0,
        updated_at timestamptz DEFAULT now(),
        PRIMARY KEY (item_id, location_id)
      );
      CREATE TABLE public.inventory_transactions(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        transaction_date date NOT NULL DEFAULT CURRENT_DATE
      );
      CREATE TABLE public.inventory_ledger(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        transaction_id uuid NOT NULL REFERENCES public.inventory_transactions(id),
        item_id uuid NOT NULL REFERENCES public.inventory_items(id),
        location_id uuid NOT NULL REFERENCES public.locations(id),
        qty_change numeric(15,3) NOT NULL,
        qty_after numeric(15,3) NOT NULL
      );
      CREATE TABLE public.audit_logs(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_id uuid,
        action text NOT NULL,
        entity_type text NOT NULL,
        entity_id text,
        old_data jsonb,
        new_data jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE FUNCTION public.has_permission(p_code text) RETURNS boolean
      LANGUAGE sql STABLE AS
        $$ SELECT coalesce(current_setting('test.allowed', true), '') = 'yes' $$;
      CREATE FUNCTION public.is_super_admin() RETURNS boolean
      LANGUAGE sql STABLE AS
        $$ SELECT coalesce(current_setting('test.super', true), '') = 'yes' $$;

      INSERT INTO public.warehouses VALUES ('${WH}', 'Gudang Utama');
      INSERT INTO public.locations VALUES
        ('${LOC_BARU}', '${WH}', 'STOK-BARU', 'Stok Baru'),
        ('${LOC_RETUR}', '${WH}', 'STOK-RETUR', 'Stok Retur');
      INSERT INTO public.inventory_items VALUES
        ('${ITEM_A}', 'SKU-A', 'Barang A'),
        ('${ITEM_B}', 'SKU-B', 'Barang B');
      INSERT INTO public.inventory_balances (item_id, location_id, qty, opening_qty) VALUES
        ('${ITEM_A}', '${LOC_BARU}', 10, 10),
        ('${ITEM_B}', '${LOC_BARU}', 6, 0);

      SET test.allowed = 'yes';
      SET test.super = 'yes';
    `);
    await db.exec(migration);

    // Barang A: 10 -> -3 (2 Nov) -> +5 (5 Nov) -> -2 (20 Nov, setelah periode)
    await movement({ itemId: ITEM_A, locationId: LOC_BARU, qty: -3, date: "2026-11-02" });
    await movement({ itemId: ITEM_A, locationId: LOC_BARU, qty: 5, date: "2026-11-05" });
    await movement({ itemId: ITEM_A, locationId: LOC_BARU, qty: -2, date: "2026-11-20" });
    // Barang B: 8 unit keluar/masuk tanpa stok awal dasar -> selisih historis.
    await movement({ itemId: ITEM_B, locationId: LOC_BARU, qty: 8, date: "2026-11-03" });
  }, 30_000);

  afterAll(async () => {
    await db?.close();
  });

  it("Stok Awal + IN - OUT = Stok Akhir untuk periode yang dipilih", async () => {
    const [row] = await report("2026-11-01", "2026-11-10", [LOC_BARU]);
    expect(row).toMatchObject({
      item_id: ITEM_A,
      opening_qty: 10,
      total_in: 5,
      total_out: 3,
      closing_qty: 12,
    });
    expect(row.opening_qty + row.total_in - row.total_out).toBe(row.closing_qty);
  });

  it("Stok Akhir periode lampau bukan saldo hari ini", async () => {
    const [row] = await report("2026-11-01", "2026-11-10", [LOC_BARU]);
    // Saldo live 10 (masih ada OUT 2 pada 20 Nov), akhir periode 10 Nov = 12.
    expect(row.balance_qty).toBe(10);
    expect(row.closing_qty).toBe(12);
  });

  it("periode tanpa transaksi: awal = akhir = saldo pada tanggal itu", async () => {
    const [row] = await report("2026-11-21", "2026-11-25", [LOC_BARU]);
    expect(row).toMatchObject({
      opening_qty: 10,
      total_in: 0,
      total_out: 0,
      closing_qty: 10,
    });
  });

  it("seluruh riwayat: Stok Awal = stok awal dasar dan rekonsiliasi", async () => {
    const rows = await report("2000-01-01", "2026-12-31", [LOC_BARU]);
    const a = rows.find((r) => r.item_id === ITEM_A)!;
    expect(a.opening_qty).toBe(10);
    expect(a.opening_baseline).toBe(10);
    expect(a.closing_qty).toBe(a.balance_qty);
    expect(a.reconciled).toBe(true);
  });

  it("mendeteksi selisih historis tanpa mengubah laporan", async () => {
    const res = await db.query<{ item_id: string; drift: string }>(
      `SELECT item_id, drift FROM public.stock_integrity($1::uuid[])`,
      [[LOC_BARU]]
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].item_id).toBe(ITEM_B);
    expect(Number(res.rows[0].drift)).toBe(-2);

    // Laporan tetap seimbang walau ada selisih historis.
    const [b] = (await report("2026-11-01", "2026-11-30", [LOC_BARU])).filter(
      (r) => r.item_id === ITEM_B
    );
    expect(b.reconciled).toBe(false);
    expect(b.opening_qty + b.total_in - b.total_out).toBe(b.closing_qty);
    expect(b.opening_qty).toBe(-2);
  });

  it("penyelarasan hanya mengubah stok awal dasar, stok fisik tetap", async () => {
    const result = await db.query<{ align_stock_opening_baselines: { rows_aligned: number } }>(
      `SELECT public.align_stock_opening_baselines($1::uuid[])`,
      [[LOC_BARU]]
    );
    expect(result.rows[0].align_stock_opening_baselines.rows_aligned).toBe(1);

    const bal = await db.query<{ qty: string; opening_qty: string }>(
      `SELECT qty, opening_qty FROM public.inventory_balances
        WHERE item_id = $1 AND location_id = $2`,
      [ITEM_B, LOC_BARU]
    );
    expect(Number(bal.rows[0].qty)).toBe(6);
    expect(Number(bal.rows[0].opening_qty)).toBe(-2);

    const audit = await db.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM public.audit_logs
        WHERE entity_type = 'inventory_balances'`
    );
    expect(Number(audit.rows[0].total)).toBe(1);

    const after = await db.query(`SELECT * FROM public.stock_integrity($1::uuid[])`, [[LOC_BARU]]);
    expect(after.rows).toHaveLength(0);
  });

  it("menolak rentang tanggal terbalik dan pengguna tanpa izin", async () => {
    await expect(report("2026-11-10", "2026-11-01")).rejects.toThrow(
      "Tanggal awal tidak boleh setelah tanggal akhir"
    );

    await db.exec("SET test.allowed = 'no'");
    await expect(report("2026-11-01", "2026-11-10")).rejects.toThrow(
      "Tidak punya izin melihat stok"
    );
    await db.exec("SET test.allowed = 'yes'");

    await db.exec("SET test.super = 'no'");
    await expect(
      db.query(`SELECT public.align_stock_opening_baselines(NULL)`)
    ).rejects.toThrow("Hanya Super Admin");
    await db.exec("SET test.super = 'yes'");
  });
});
