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
