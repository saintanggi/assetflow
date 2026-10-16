// Menjaga agar parser di Edge Function (Deno) identik dengan yang dipakai browser.
// Bila tes ini gagal: jalankan `npm run sync:parser`.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const SRC = "src/lib/shippingUpload.ts";
const DST = "supabase/functions/sync-sheets/shippingUpload.ts";
const HEADER_LINES = 5; // blok komentar "SALINAN OTOMATIS" di awal file tujuan

describe("parser Edge Function", () => {
  it("salinan shippingUpload.ts identik dengan src/lib (kecuali import xlsx)", () => {
    const src = readFileSync(SRC, "utf8").replace('import * as XLSX from "xlsx";', 'import * as XLSX from "./xlsx.ts";');
    const dst = readFileSync(DST, "utf8").split("\n").slice(HEADER_LINES).join("\n");
    expect(dst.trimEnd()).toBe(src.trimEnd());
  });

  it("Edge Function memakai parser hasil salinan + fungsi khusus service role", () => {
    const fn = readFileSync("supabase/functions/sync-sheets/index.ts", "utf8");
    expect(fn).toContain('from "./shippingUpload.ts"');
    expect(fn).toContain("sync_ship_request_items"); // RPC yang mengizinkan service_role
    expect(fn).toContain("pickNewestSheet"); // selalu pakai sheet terbaru
    const migrasi = readFileSync("supabase/migrations/20261015000030_sheet_sync_functions.sql", "utf8");
    expect(migrasi).toContain("is_service_role");
    expect(migrasi).toContain("sync_ship_request_items");
  });
});

describe("pengiriman sesuai kondisi aset", () => {
  it("RPC manual dan sinkronisasi memisahkan OUT per lokasi status aset", () => {
    const migration = readFileSync("supabase/migrations/20261016000034_fix_sync_ship_asset_condition.sql", "utf8");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.sync_ship_request_items");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.ship_request_items");
    expect(migration).toContain("WHEN 'ASSET RETUR' THEN v_loc_retur");
    expect(migration).toContain("WHEN 'UNREADY'     THEN v_loc_unready");
    expect(migration).toContain("FOR v_group_loc IN SELECT DISTINCT location_id");
    expect(migration).toContain("LIKE '%RETURN%'");
    expect(migration).not.toContain("COALESCE(v_loc_retur, p_location_id)");
    expect(migration).not.toContain("COALESCE(v_loc_baru, p_location_id)");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.sync_ship_request_items");
  });

  it("salinan SQL untuk deployment manual identik dengan migration", () => {
    const migration = readFileSync("supabase/migrations/20261016000034_fix_sync_ship_asset_condition.sql", "utf8");
    const copy = readFileSync("docs/sql/fix_sync_ship_asset_condition.sql", "utf8");
    expect(copy).toBe(migration);
  });
});

describe("penghapusan transaksi dan permintaan", () => {
  it("menghapus efek ledger, memulihkan saldo, dan mengunci operasi ke superadmin", () => {
    const migration = readFileSync("supabase/migrations/20261016000035_admin_delete_request_and_transaction.sql", "utf8");
    expect(migration).toContain("public.is_super_admin()");
    expect(migration).toContain("admin_delete_inventory_transaction");
    expect(migration).toContain("trg_purge_request_inventory_history");
    expect(migration).toContain("DELETE FROM public.inventory_ledger");
    expect(migration).toContain("qty = public.inventory_balances.qty + EXCLUDED.qty");
    expect(migration).toContain("child.reversal_of = parent.id");
    expect(migration).not.toContain("INSERT INTO public.inventory_transactions");
    expect(migration).not.toContain("public._apply_posted_effects");
  });

  it("salinan SQL dashboard sama dengan migration", () => {
    const migration = readFileSync("supabase/migrations/20261016000035_admin_delete_request_and_transaction.sql", "utf8");
    const copy = readFileSync("docs/sql/admin_delete_request_and_transaction.sql", "utf8");
    expect(copy).toBe(migration);
  });
});

describe("versi satu file (untuk di-paste di Supabase Dashboard)", () => {
  const bundle = readFileSync("docs/sync-sheets-standalone.ts", "utf8");
  it("berisi handler + parser + helper tanpa import lokal", () => {
    expect(bundle).toContain("Deno.serve");
    expect(bundle).toContain("export function pickNewestSheet");
    expect(bundle).toContain("export function applySheetDate");
    expect(bundle).toContain("sync_ship_request_items");
    expect(bundle).toContain("downloadWorkbook");
    expect(bundle).not.toMatch(/from "\.\//);
    // hanya boleh punya 2 import npm (xlsx + supabase-js)
    expect(bundle.match(/^import /gm)?.length).toBe(2);
  });
  it("ikut memakai aturan qty terbaru dari parser", () => {
    const src = readFileSync(SRC, "utf8");
    const ciri = "const total = round3(Math.max(explicit, barcodes.size, n));";
    expect(src).toContain(ciri);
    expect(bundle).toContain(ciri);
  });
});
