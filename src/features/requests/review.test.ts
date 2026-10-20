import { describe, expect, it } from "vitest";
import type { RequestItem } from "../../types/database";
import {
  buildRequestReviewPlan,
  canRecoverZeroQtyItem,
  withWaitingStockNote,
} from "./review";

function line(overrides: Partial<Pick<RequestItem,
  "id" | "request_id" | "item_id" | "qty_requested" | "item_type" | "status_aset" | "notes"
>> & { name?: string } = {}) {
  return {
    id: "line-1",
    request_id: "request-1",
    item_id: "item-1",
    qty_requested: 5,
    item_type: "Mouse wireless",
    status_aset: "ASSET BARU",
    notes: "Status request: PENAMBAHAN",
    name: "Mouse",
    ...overrides,
  };
}

const requestStatus = { status: "diajukan" as const, rejection_reason: null };

describe("buildRequestReviewPlan", () => {
  it("mengubah qty 0 karena stok kosong menjadi menunggu stok, bukan ditolak", () => {
    const plan = buildRequestReviewPlan([line()], { "line-1": "0" }, "Stok kosong, menunggu restock");

    expect(plan.requestStatus).toBe("disetujui_sebagian");
    expect(plan.pendingStockCount).toBe(1);
    expect(plan.pendingStockInserts).toEqual([]);
    expect(plan.updates).toEqual([
      {
        itemId: "line-1",
        values: {
          qty_approved: null,
          item_status: "menunggu_stok",
          notes: "Menunggu stok: Stok kosong, menunggu restock\nStatus request: PENAMBAHAN",
        },
      },
    ]);
  });

  it("memecah qty yang disetujui sebagian dan menyimpan sisanya sebagai menunggu stok", () => {
    const plan = buildRequestReviewPlan([line()], { "line-1": "2" }, "Stok tersedia 2 unit");

    expect(plan.requestStatus).toBe("disetujui_sebagian");
    expect(plan.pendingStockCount).toBe(1);
    expect(plan.updates[0]).toMatchObject({
      itemId: "line-1",
      values: { qty_requested: 2, qty_approved: 2, item_status: "disetujui" },
    });
    expect(plan.pendingStockInserts[0]).toMatchObject({
      request_id: "request-1",
      item_id: "item-1",
      qty_requested: 3,
      qty_approved: null,
      qty_shipped: 0,
      item_status: "menunggu_stok",
      notes: "Menunggu stok: Stok tersedia 2 unit\nStatus request: PENAMBAHAN",
    });
  });

  it("mencatat header sebagian ketika semua qty disetujui adalah 0", () => {
    const plan = buildRequestReviewPlan(
      [line(), line({ id: "line-2", item_id: "item-2", name: "Keyboard" })],
      { "line-1": "0", "line-2": "0" },
      "Stok kosong",
    );

    expect(plan.requestStatus).toBe("disetujui_sebagian");
    expect(plan.pendingStockCount).toBe(2);
    expect(plan.updates.every((update) => update.values.item_status === "menunggu_stok")).toBe(true);
  });

  it("menandai permintaan disetujui penuh bila semua qty tersedia", () => {
    const plan = buildRequestReviewPlan([line()], { "line-1": "5" }, "");
    expect(plan.requestStatus).toBe("disetujui");
    expect(plan.pendingStockCount).toBe(0);
    expect(plan.updates[0].values).toMatchObject({ qty_approved: 5, item_status: "disetujui" });
  });

  it("mewajibkan keterangan gudang saat qty 0 atau sebagian", () => {
    expect(() => buildRequestReviewPlan([line()], { "line-1": "0" }, " ")).toThrow(
      "Keterangan gudang wajib diisi",
    );
    expect(() => buildRequestReviewPlan([line()], { "line-1": "2" }, "")).toThrow(
      "Keterangan gudang wajib diisi",
    );
  });

  it("menolak nilai qty yang negatif, melebihi permintaan, atau bukan angka", () => {
    expect(() => buildRequestReviewPlan([line()], { "line-1": "-1" }, "")).toThrow("Qty setuju");
    expect(() => buildRequestReviewPlan([line()], { "line-1": "6" }, "")).toThrow("Qty setuju");
    expect(() => buildRequestReviewPlan([line()], { "line-1": "abc" }, "")).toThrow("Qty setuju");
  });
});

describe("withWaitingStockNote", () => {
  it("mempertahankan keterangan yang sudah ada", () => {
    expect(withWaitingStockNote("Catatan tiket", "Stok kosong")).toBe(
      "Menunggu stok: Stok kosong\nCatatan tiket",
    );
  });
});

describe("canRecoverZeroQtyItem", () => {
  const item = {
    item_status: "ditolak",
    qty_requested: 1,
    qty_approved: 0,
    qty_shipped: 0,
  } as RequestItem;

  it("mengizinkan memulihkan item nol dari alur review lama", () => {
    expect(canRecoverZeroQtyItem(item, requestStatus)).toBe(true);
    expect(canRecoverZeroQtyItem(item, { status: "disetujui_sebagian", rejection_reason: null })).toBe(true);
  });

  it("tidak menampilkan pemulihan untuk penolakan eksplisit atau item yang sudah diproses", () => {
    expect(canRecoverZeroQtyItem(item, { status: "ditolak", rejection_reason: "Tidak sesuai kebijakan" })).toBe(false);
    expect(canRecoverZeroQtyItem({ ...item, item_status: "menunggu_stok" }, requestStatus)).toBe(false);
    expect(canRecoverZeroQtyItem({ ...item, qty_shipped: 1 }, requestStatus)).toBe(false);
  });
});
