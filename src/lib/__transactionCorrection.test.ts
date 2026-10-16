import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migrationPath = "supabase/migrations/20261016000036_fix_admin_correct_txn_item_idempotent.sql";
const copyPath = "docs/sql/fix_admin_correct_txn_item.sql";

describe("koreksi status aset transaksi", () => {
  it("memakai lokasi efektif koreksi terakhir supaya koreksi tidak berulang menambah transfer", () => {
    const migration = readFileSync(migrationPath, "utf8");
    expect(migration).toContain("v_effective_loc");
    expect(migration).toContain("c.reference = 'KOREKSI-ADMIN/' || p_transaction_id::text");
    expect(migration).toContain("v_tii.status_aset = v_norm AND v_effective_loc = v_new_loc");
    expect(migration).toContain("Hanya super admin yang boleh mengoreksi log transaksi");
  });

  it("SQL untuk Supabase Dashboard identik dengan migration", () => {
    expect(readFileSync(copyPath, "utf8")).toBe(readFileSync(migrationPath, "utf8"));
  });

  it("Log Transaksi menampilkan status aset transaksi terbarukan, bukan menimpanya dengan status request", () => {
    const page = readFileSync("src/pages/TransactionLogPage.tsx", "utf8");
    expect(page).toContain("const statusAset = det.statusAset || requestStatus || \"\"");
    expect(page).toContain("requestStatusAset: requestStatus ?? \"\"");
    expect(page).toContain("Koreksi stok tercatat");
  });
});
