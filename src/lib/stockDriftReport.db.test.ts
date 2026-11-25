// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * `docs/sql/stock_drift_report.sql` dipakai untuk menjelaskan selisih historis
 * ke pengguna. Tes ini memastikan skrip valid dan angkanya benar dengan data
 * nyata KBL-005 (qty 785, stok awal 833, ledger −160 → drift 112).
 */

const LOC = "00000000-0000-0000-0000-0000000000a1";
const ITEM = "00000000-0000-0000-0000-0000000000c1";

let db: PGlite;

type Summary = {
  baris_selisih: number;
  total_unit_selisih: string;
  tanpa_riwayat_ledger: number;
  diubah_setelah_ledger_terakhir: number;
  total_baris_saldo: number;
};

describe("stock_drift_report.sql (PostgreSQL/PGlite)", () => {
  let results: { fields: { name: string }[]; rows: unknown[] }[] = [];

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE SCHEMA extensions;
      CREATE TABLE public.locations(id uuid PRIMARY KEY, code text, name text, warehouse_id uuid);
      CREATE TABLE public.inventory_items(id uuid PRIMARY KEY, sku text, name text);
      CREATE TABLE public.inventory_balances(
        item_id uuid, location_id uuid, qty numeric, opening_qty numeric,
        updated_at timestamptz DEFAULT now()
      );
      CREATE TABLE public.inventory_ledger(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, location_id uuid,
        qty_change numeric, transaction_id uuid, created_at timestamptz DEFAULT now()
      );
      CREATE TABLE public.audit_logs(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entity_type text,
        entity_id text, created_at timestamptz DEFAULT now()
      );

      INSERT INTO public.locations VALUES ('${LOC}', 'STOK-RETUR', 'Stok Retur', NULL);
      INSERT INTO public.inventory_items VALUES ('${ITEM}', 'KBL-005', 'Scanner Kabel 2D');
      INSERT INTO public.inventory_balances VALUES ('${ITEM}', '${LOC}', 785, 833, now());
      INSERT INTO public.inventory_ledger(item_id, location_id, qty_change)
      VALUES ('${ITEM}', '${LOC}', -160);
    `);

    results = (await db.exec(
      readFileSync(new URL("../../docs/sql/stock_drift_report.sql", import.meta.url), "utf8")
    )) as typeof results;
  }, 30_000);

  afterAll(async () => {
    await db?.close();
  });

  it("mengembalikan tiga hasil: ringkasan, per lokasi, detail", () => {
    expect(results).toHaveLength(3);
  });

  it("ringkasan menghitung 1 baris selisih sebesar 112 unit", () => {
    const s = results[0].rows[0] as Summary;
    expect(Number(s.baris_selisih)).toBe(1);
    expect(Number(s.total_unit_selisih)).toBe(112);
    expect(Number(s.total_baris_saldo)).toBe(1);
    expect(Number(s.tanpa_riwayat_ledger)).toBe(0);
  });

  it("detail memuat angka yang sama dengan tabel drift pengguna", () => {
    const d = results[2].rows[0] as {
      sku: string;
      location_code: string;
      qty: string;
      opening_qty: string;
      ledger_net: string;
      drift: string;
    };
    expect(d.sku).toBe("KBL-005");
    expect(d.location_code).toBe("STOK-RETUR");
    expect(Number(d.qty)).toBe(785);
    expect(Number(d.opening_qty)).toBe(833);
    expect(Number(d.ledger_net)).toBe(-160);
    expect(Number(d.drift)).toBe(112);
  });
});
