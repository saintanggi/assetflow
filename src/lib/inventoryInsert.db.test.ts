// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const UNIT_ID = "00000000-0000-0000-0000-0000000000u1".replace("u", "a");

let db: PGlite;

describe("inventory_items_before_insert (PostgreSQL/PGlite)", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE SCHEMA extensions;
      CREATE TABLE public.units (id uuid PRIMARY KEY, code text NOT NULL UNIQUE);
      INSERT INTO public.units VALUES ('${UNIT_ID}', 'unit');

      CREATE TABLE public.inventory_items (
        id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
        sku            text          NOT NULL UNIQUE,
        name           text          NOT NULL,
        unit_id        uuid          NOT NULL REFERENCES public.units(id),
        barcode        text          UNIQUE,
        min_stock      numeric(15,3) NOT NULL DEFAULT 0,
        is_active      boolean       NOT NULL DEFAULT true,
        CONSTRAINT items_min_stock_check CHECK (min_stock >= 0)
      );
    `);

    const sql = readFileSync(
      new URL("../../supabase/migrations/20261126000004_inventory_items_min_stock_default.sql", import.meta.url),
      "utf8"
    );
    await db.exec(sql);
    await db.exec(`
      CREATE TRIGGER trg_items_bi
        BEFORE INSERT ON public.inventory_items
        FOR EACH ROW EXECUTE FUNCTION public.inventory_items_before_insert();
    `);
  }, 30_000);

  afterAll(async () => {
    await db?.close();
  });

  it("menormalkan min_stock NULL menjadi 0 dan barcode kosong menjadi sku", async () => {
    const res = await db.query<{ sku: string; barcode: string; min_stock: string }>(`
      INSERT INTO public.inventory_items (sku, name, unit_id, barcode, min_stock)
      VALUES ('KIP-009', 'Kipas Angin Wall 20" Sekai IWF 2038', '${UNIT_ID}', NULL, NULL)
      RETURNING sku, barcode, min_stock;
    `);
    expect(res.rows[0]).toEqual({
      sku: "KIP-009",
      barcode: "KIP-009",
      min_stock: "0.000",
    });
  });

  it("tetap menjaga nilai min_stock positif dan menolak min_stock negatif", async () => {
    const res = await db.query<{ min_stock: string }>(`
      INSERT INTO public.inventory_items (sku, name, unit_id, barcode, min_stock)
      VALUES ('KIP-010', 'Kipas Test', '${UNIT_ID}', 'BC-10', 7)
      RETURNING min_stock;
    `);
    expect(res.rows[0].min_stock).toBe("7.000");

    await expect(
      db.query(`
        INSERT INTO public.inventory_items (sku, name, unit_id, min_stock)
        VALUES ('KIP-011', 'Kipas Negatif', '${UNIT_ID}', -1);
      `)
    ).rejects.toThrow(/items_min_stock_check/);
  });
});
