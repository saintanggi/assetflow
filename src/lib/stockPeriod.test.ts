import { describe, expect, it } from "vitest";
import {
  computeStockIntegrity,
  computeStockPeriod,
  type RawBalance,
  type RawMove,
} from "./stockPeriod";

/**
 * Skenario sama dengan tes database (stockPeriod.db.test.ts):
 *  - Barang A: stok awal dasar 10, OUT 3 (2 Nov), IN 5 (5 Nov), OUT 2 (20 Nov).
 *  - Barang B: saldo 6, tapi ledger +8 → selisih historis -2.
 *  - Barang C: hanya punya mutasi (saldo 0) → tetap muncul di periode.
 */
const LOC = "loc-baru";
const balances: RawBalance[] = [
  { item_id: "A", location_id: LOC, qty: 10, opening_qty: 10 },
  { item_id: "B", location_id: LOC, qty: 6, opening_qty: 0 },
  { item_id: "C", location_id: LOC, qty: 0, opening_qty: 0 },
];
const moves: RawMove[] = [
  { item_id: "A", location_id: LOC, qty_change: -3, txnDate: "2026-11-02" },
  { item_id: "A", location_id: LOC, qty_change: 5, txnDate: "2026-11-05" },
  { item_id: "A", location_id: LOC, qty_change: -2, txnDate: "2026-11-20" },
  { item_id: "B", location_id: LOC, qty_change: 8, txnDate: "2026-11-03" },
  { item_id: "C", location_id: LOC, qty_change: 4, txnDate: "2026-11-04" },
  { item_id: "C", location_id: LOC, qty_change: -4, txnDate: "2026-11-06" },
];

const find = (rows: ReturnType<typeof computeStockPeriod>, id: string) =>
  rows.find((r) => r.item_id === id)!;

describe("computeStockPeriod", () => {
  it("Stok Awal + IN − OUT = Stok Akhir", () => {
    const rows = computeStockPeriod(balances, moves, "2026-11-01", "2026-11-10");
    const a = find(rows, "A");
    expect(a).toMatchObject({ opening: 10, totalIn: 5, totalOut: 3, closing: 12 });
    expect(a.opening + a.totalIn - a.totalOut).toBe(a.closing);
  });

  it("Stok Akhir periode lampau bukan saldo hari ini", () => {
    const a = find(computeStockPeriod(balances, moves, "2026-11-01", "2026-11-10"), "A");
    expect(a.balance).toBe(10);
    expect(a.closing).toBe(12);
  });

  it("mutasi di luar periode tidak dihitung sebagai IN/OUT", () => {
    const rows = computeStockPeriod(balances, moves, "2026-11-21", "2026-11-25");
    const a = find(rows, "A");
    expect(a).toMatchObject({ opening: 10, totalIn: 0, totalOut: 0, closing: 10 });
  });

  it("periode satu hari (pengiriman bertanggal lampau) tetap benar", () => {
    const rows = computeStockPeriod(balances, moves, "2026-11-02", "2026-11-02");
    const a = find(rows, "A");
    // Saldo akhir 2 Nov = 10 − 3 = 7 (bukan saldo hari ini 10).
    expect(a).toMatchObject({ opening: 10, totalOut: 3, closing: 7 });
  });

  it("barang yang sudah habis tetap muncul bila ada mutasi di periode", () => {
    const rows = computeStockPeriod(balances, moves, "2026-11-01", "2026-11-10");
    const c = find(rows, "C");
    expect(c).toMatchObject({ opening: 0, totalIn: 4, totalOut: 4, closing: 0 });
  });

  it("menandai selisih historis tapi laporan tetap seimbang", () => {
    const rows = computeStockPeriod(balances, moves, "2026-11-01", "2026-11-30");
    const b = find(rows, "B");
    expect(b.reconciled).toBe(false);
    expect(b.opening).toBe(-2);
    expect(b.opening + b.totalIn - b.totalOut).toBe(b.closing);
  });

  it("seluruh riwayat: Stok Awal = stok awal dasar bila rekonsiliasi", () => {
    const a = find(computeStockPeriod(balances, moves, "2000-01-01", "2026-12-31"), "A");
    expect(a.opening).toBe(a.openingBaseline);
    expect(a.reconciled).toBe(true);
  });

  it("audit integritas hanya mengembalikan baris yang selisih", () => {
    const rows = computeStockIntegrity(balances, moves);
    expect(rows.map((r) => r.item_id)).toEqual(["B"]);
    expect(rows[0].drift).toBe(-2);
  });

  it("tidak berubah untuk qty desimal (satuan kg/meter)", () => {
    const rows = computeStockPeriod(
      [{ item_id: "D", location_id: LOC, qty: 1.5, opening_qty: 1 }],
      [{ item_id: "D", location_id: LOC, qty_change: 0.5, txnDate: "2026-11-05" }],
      "2026-11-01",
      "2026-11-30"
    );
    expect(rows[0]).toMatchObject({ opening: 1, totalIn: 0.5, closing: 1.5 });
  });
});
