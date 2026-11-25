// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Skrip `docs/sql/verify_stock_migration.sql` harus benar-benar bisa
 * dijalankan di Supabase SQL Editor dan memberi hasil akurat.
 *
 * Tes ini membangun skema minimal, menerapkan ketiga migrasi, lalu menjalankan
 * skrip verifikasi dan memastikan semua baris sesuai harapan.
 */

const read = (rel: string) =>
  readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");

let db: PGlite;
let checks: { no: number; cek: string; hasil: string; detail: string }[] = [];

const LOC = "00000000-0000-0000-0000-0000000000a1";
const WH = "00000000-0000-0000-0000-0000000000b1";
const ITEM = "00000000-0000-0000-0000-0000000000c1";
const ITEM2 = "00000000-0000-0000-0000-0000000000c2";

describe("verify_stock_migration.sql (PostgreSQL/PGlite)", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;

      CREATE SCHEMA extensions;

      CREATE TABLE public.warehouses(id uuid PRIMARY KEY, name text NOT NULL);
      CREATE TABLE public.locations(
        id uuid PRIMARY KEY, code text NOT NULL, name text NOT NULL,
        warehouse_id uuid REFERENCES public.warehouses(id)
      );
      CREATE TABLE public.inventory_items(
        id uuid PRIMARY KEY, sku text NOT NULL, name text NOT NULL
      );
      CREATE TABLE public.inventory_balances(
        item_id uuid NOT NULL, location_id uuid NOT NULL,
        qty numeric NOT NULL DEFAULT 0, opening_qty numeric NOT NULL DEFAULT 0,
        PRIMARY KEY (item_id, location_id)
      );
      CREATE TABLE public.inventory_ledger(
        id bigserial PRIMARY KEY, item_id uuid NOT NULL, location_id uuid NOT NULL,
        qty_change numeric NOT NULL, transaction_id uuid
      );
      CREATE TABLE public.inventory_transactions(
        id uuid PRIMARY KEY, transaction_date date NOT NULL, status text NOT NULL DEFAULT 'posted'
      );
      CREATE TABLE public.requests(
        id uuid PRIMARY KEY, status text, updated_at timestamptz
      );
      CREATE TABLE public.request_items(
        id uuid PRIMARY KEY, request_id uuid, qty_requested numeric,
        qty_approved numeric, qty_shipped numeric, item_status text,
        resi text, barcode text, serial_number text, updated_at timestamptz
      );

      CREATE FUNCTION public.has_permission(p text) RETURNS boolean
      LANGUAGE sql STABLE AS $$ SELECT true $$;
      CREATE FUNCTION public.is_super_admin() RETURNS boolean
      LANGUAGE sql STABLE AS $$ SELECT true $$;

      INSERT INTO public.warehouses VALUES ('${WH}', 'Gudang Pusat');
      INSERT INTO public.locations VALUES ('${LOC}', 'STOK-BARU', 'Stok Baru', '${WH}');
      INSERT INTO public.inventory_items VALUES
        ('${ITEM}', 'CPU-01', 'CPU Rakitan'),
        ('${ITEM2}', 'RAM-01', 'RAM 8GB');

      -- Item 1: stok awal 10, +5, −3 → saldo 12 (sinkron).
      INSERT INTO public.inventory_balances VALUES ('${ITEM}', '${LOC}', 12, 10);
      INSERT INTO public.inventory_ledger(item_id, location_id, qty_change)
      VALUES ('${ITEM}', '${LOC}', 5), ('${ITEM}', '${LOC}', -3);

      -- Item 2: saldo 4 tanpa ledger & stok awal 0 → drift 4 (untuk uji panel).
      INSERT INTO public.inventory_balances VALUES ('${ITEM2}', '${LOC}', 4, 0);
    `);

    await db.exec(read("supabase/migrations/20261125000001_stock_consistency.sql"));
    await db.exec(read("supabase/migrations/20261125000002_quick_ship_partial.sql"));
    await db.exec(read("supabase/migrations/20261125000003_stock_console_access.sql"));

    // Jalankan skrip verifikasi apa adanya (seperti ditempel di SQL Editor).
    const results = await db.exec(read("docs/sql/verify_stock_migration.sql"));
    const table = results.find(
      (r) => Array.isArray(r.fields) && r.fields.some((f) => f.name === "hasil")
    );
    checks = (table?.rows ?? []) as typeof checks;
  }, 60_000);

  afterAll(async () => {
    await db?.close();
  });

  it("mengembalikan satu tabel hasil dengan 10 pemeriksaan", () => {
    expect(checks).toHaveLength(10);
    expect(checks.map((c) => c.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("fungsi baca bisa dipanggil dari sesi konsol DB tanpa error izin", () => {
    // Ini kasus yang dulu gagal di SQL Editor: "Tidak punya izin melihat stok".
    const c = checks.find((x) => x.no === 7)!;
    expect(c.hasil).toBe("LULUS");
    expect(c.detail).toContain("0 baris tidak seimbang");
  });

  it("semua pemeriksaan struktural LULUS", () => {
    const struktural = checks.filter((c) => c.no <= 8);
    expect(struktural.map((c) => `${c.no}:${c.hasil}`)).toEqual(
      struktural.map((c) => `${c.no}:LULUS`)
    );
  });

  it("mendeteksi drift historis sebagai PERHATIAN (bukan gagal)", () => {
    const drift = checks.find((c) => c.no === 9)!;
    expect(drift.hasil).toBe("PERHATIAN");
    expect(drift.detail).toContain("1 baris selisih");
  });

  it("rumus tetap seimbang untuk periode lampau", () => {
    const c = checks.find((x) => x.no === 8)!;
    expect(c.hasil).toBe("LULUS");
  });
});
