// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Kirim Cepat tidak boleh menghilangkan sisa permintaan.
 *
 * Sebelum perbaikan: qty_approved diturunkan menjadi qty kirim, sehingga
 * `ship_request_items` menandai baris 'terkirim' walau baru sebagian dikirim —
 * sisanya hilang dari "Sisa Belum Terkirim".
 *
 * Tes ini memakai `ship_request_items` tiruan yang meniru aturan status
 * (terkirim bila qty_shipped >= qty_approved, selain itu pending_sebagian).
 */

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20261125000002_quick_ship_partial.sql",
    import.meta.url
  ),
  "utf8"
);

const REQ = "00000000-0000-0000-0000-000000000001";
const ITEM = "00000000-0000-0000-0000-000000000011";

let db: PGlite;

async function quickShip(qty: number, itemId = ITEM) {
  return db.query<{ quick_ship_request: string }>(
    `SELECT public.quick_ship_request($1, $2::jsonb, $3, NULL)`,
    [
      REQ,
      JSON.stringify([{ request_item_id: itemId, qty, resi: "RESI-1", barcode: "BC-1" }]),
      "tes",
    ]
  );
}

describe("quick_ship_request — sisa tidak hilang (PostgreSQL/PGlite)", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;

      CREATE TABLE public.requests(
        id uuid PRIMARY KEY,
        status text NOT NULL DEFAULT 'diajukan',
        updated_at timestamptz DEFAULT now()
      );
      CREATE TABLE public.request_items(
        id uuid PRIMARY KEY,
        request_id uuid NOT NULL,
        qty_requested numeric NOT NULL,
        qty_approved numeric,
        qty_shipped numeric NOT NULL DEFAULT 0,
        item_status text NOT NULL DEFAULT 'menunggu',
        resi text,
        barcode text,
        serial_number text,
        updated_at timestamptz DEFAULT now()
      );

      CREATE FUNCTION public.is_super_admin() RETURNS boolean
      LANGUAGE sql STABLE AS $$ SELECT true $$;

      -- Tiruan ship_request_items: hanya menaikkan qty_shipped dan status.
      CREATE FUNCTION public.ship_request_items(
        p_request_id uuid,
        p_location_id uuid,
        p_lines jsonb,
        p_notes text DEFAULT NULL,
        p_allow_negative boolean DEFAULT false
      ) RETURNS uuid LANGUAGE plpgsql AS $$
      DECLARE
        v_line jsonb;
        v_id uuid;
        v_qty numeric;
      BEGIN
        FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
          v_id := (v_line->>'request_item_id')::uuid;
          v_qty := (v_line->>'qty')::numeric;
          UPDATE public.request_items
             SET qty_shipped = qty_shipped + v_qty,
                 item_status = CASE
                   WHEN qty_shipped + v_qty >= qty_approved THEN 'terkirim'
                   ELSE 'pending_sebagian'
                 END,
                 updated_at = now()
           WHERE id = v_id;
        END LOOP;
        RETURN gen_random_uuid();
      END $$;

      INSERT INTO public.requests(id, status) VALUES ('${REQ}', 'diajukan');
      INSERT INTO public.request_items(id, request_id, qty_requested)
      VALUES ('${ITEM}', '${REQ}', 5);
    `);
    await db.exec(migration);
  }, 30_000);

  afterAll(async () => {
    await db?.close();
  });

  it("kirim sebagian menyisakan pending_sebagian, bukan terkirim", async () => {
    await quickShip(2);
    const row = (
      await db.query<{
        qty_requested: string;
        qty_approved: string;
        qty_shipped: string;
        item_status: string;
      }>(
        `SELECT qty_requested, qty_approved, qty_shipped, item_status
           FROM public.request_items WHERE id = $1`,
        [ITEM]
      )
    ).rows[0];

    expect(Number(row.qty_requested)).toBe(5);
    expect(Number(row.qty_approved)).toBe(5); // tidak diturunkan jadi 2
    expect(Number(row.qty_shipped)).toBe(2);
    expect(row.item_status).toBe("pending_sebagian");
    // Sisa yang masih bisa dikirim = 5 − 2 = 3.
    expect(Number(row.qty_approved) - Number(row.qty_shipped)).toBe(3);
  });

  it("kirim pelunasan menandai terkirim", async () => {
    await db.exec(
      `UPDATE public.request_items SET item_status = 'disetujui' WHERE id = '${ITEM}'`
    );
    await quickShip(3);
    const row = (
      await db.query<{ qty_shipped: string; item_status: string }>(
        `SELECT qty_shipped, item_status FROM public.request_items WHERE id = $1`,
        [ITEM]
      )
    ).rows[0];
    expect(Number(row.qty_shipped)).toBe(5);
    expect(row.item_status).toBe("terkirim");
  });
});
