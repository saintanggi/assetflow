import { describe, expect, it } from "vitest";
import {
  formatShipError,
  itemStockLines,
  stockForAset,
  stockShortageHint,
  targetLocationOf,
  type ShipErrorContext,
} from "./shipStock";
import type { RequestItem } from "../../types/database";

const ITEM_ID = "11111111-1111-1111-1111-111111111111";
const LOC_BARU = "22222222-2222-2222-2222-222222222222";
const LOC_RETUR = "33333333-3333-3333-3333-333333333333";
const LOC_UNREADY = "44444444-4444-4444-4444-444444444444";

const locations = [
  { id: LOC_BARU, code: "STOK-BARU", name: "Stok Barang Baru" },
  { id: LOC_RETUR, code: "STOK-RETUR", name: "Stok Barang Retur" },
  { id: LOC_UNREADY, code: "STOK-UNREADY", name: "Stok Unready" },
];

function item(statusAset: string | null): RequestItem {
  return {
    id: "ri-1",
    request_id: "req-1",
    item_id: ITEM_ID,
    qty_requested: 1,
    qty_approved: 1,
    qty_shipped: 0,
    barcode: null,
    serial_number: null,
    item_type: null,
    status_aset: statusAset,
    resi: null,
    item_status: "siap",
    notes: null,
    processed_by: null,
    created_at: "2026-10-19T00:00:00Z",
    updated_at: "2026-10-19T00:00:00Z",
    inventory_items: {
      sku: "MON-01",
      name: "MONITOR",
      brand: null,
      unit_code: "UNIT",
    },
  };
}

function ctx(statusAset: string | null = "ASSET BARU"): ShipErrorContext {
  return {
    items: [item(statusAset)],
    locations,
    stock: { [ITEM_ID]: 22 },
    // Saldo STOK-BARU minus, stok 22 ada di STOK-RETUR.
    stockByLoc: {
      [`${ITEM_ID}|${LOC_BARU}`]: -8,
      [`${ITEM_ID}|${LOC_RETUR}`]: 22,
    },
  };
}

describe("targetLocationOf", () => {
  it("memetakan Status Aset ke lokasi pemotong yang sama dengan RPC", () => {
    expect(targetLocationOf(item("ASSET BARU"), locations).loc?.code).toBe("STOK-BARU");
    expect(targetLocationOf(item("ASSET RETUR"), locations).loc?.code).toBe("STOK-RETUR");
    expect(targetLocationOf(item("UNREADY"), locations).loc?.code).toBe("STOK-UNREADY");
  });

  it("memakai STOK-BARU untuk status kosong / tak dikenal", () => {
    expect(targetLocationOf(item(null), locations).code).toBe("STOK-BARU");
    expect(targetLocationOf(item("entah"), locations).code).toBe("STOK-BARU");
  });
});

describe("formatShipError", () => {
  const raw =
    `Stok tidak mencukupi (item ${ITEM_ID}, lokasi ${LOC_BARU}): ` +
    "tersedia -8.000, perubahan -1.000";

  it("membaca saldo negatif tanpa menampilkan 'tersedia ?'", () => {
    const msg = formatShipError(raw, ctx());
    expect(msg).not.toContain("?");
    expect(msg).toContain("-8");
    expect(msg).toContain("1");
  });

  it("menyebut nama barang, lokasi pemotong, total semua lokasi, dan rinciannya", () => {
    const msg = formatShipError(raw, ctx());
    expect(msg).toContain('Stok "MONITOR"');
    expect(msg).toContain("STOK-BARU");
    expect(msg).toContain("Stok Barang Baru");
    expect(msg).toContain("Stok total semua lokasi 22");
    expect(msg).toContain("STOK-RETUR 22");
  });

  it("memberi saran konkret: ubah Status Aset ke lokasi yang punya stok", () => {
    const msg = formatShipError(raw, ctx());
    expect(msg).toContain("ASSET RETUR");
    expect(msg).toContain("minus");
  });

  it("tetap informatif saat saldo lokasi nol (bukan negatif)", () => {
    const msg = formatShipError(
      `Stok tidak mencukupi (item ${ITEM_ID}, lokasi ${LOC_BARU}): tersedia 0.000, perubahan -1.000`,
      ctx("ASSET RETUR")
    );
    expect(msg).toContain("tersedia 0");
    expect(msg).toContain("STOK-RETUR");
    expect(msg).not.toContain("minus");
  });

  it("membersihkan UUID pada pesan error lain", () => {
    const msg = formatShipError(`Item belum di-approve (id ${ITEM_ID})`, ctx());
    expect(msg).not.toContain(ITEM_ID);
    expect(msg).toContain("[id]");
  });
});

describe("itemStockLines (form Buat Permintaan)", () => {
  const stockByLoc = {
    [`${ITEM_ID}|${LOC_BARU}`]: 22,
    [`${ITEM_ID}|${LOC_RETUR}`]: 3,
  };

  it("menampilkan sisa stok Baru, Retur, Unready secara berurutan", () => {
    const lines = itemStockLines(ITEM_ID, locations, stockByLoc);
    expect(lines.map((l) => l.label)).toEqual(["Baru", "Retur", "Unready"]);
    expect(lines.map((l) => l.qty)).toEqual([22, 3, 0]);
  });

  it("mengembalikan 0 bila barang belum punya saldo", () => {
    const lines = itemStockLines("item-lain", locations, {});
    expect(lines.every((l) => l.qty === 0)).toBe(true);
  });
});

describe("stockForAset", () => {
  const stockByLoc = {
    [`${ITEM_ID}|${LOC_BARU}`]: 22,
    [`${ITEM_ID}|${LOC_RETUR}`]: 3,
  };

  it("memakai saldo lokasi sesuai Status Asset", () => {
    expect(stockForAset(ITEM_ID, "ASSET BARU", locations, stockByLoc)).toMatchObject({
      code: "STOK-BARU",
      qty: 22,
    });
    expect(stockForAset(ITEM_ID, "ASSET RETUR", locations, stockByLoc)).toMatchObject({
      code: "STOK-RETUR",
      qty: 3,
    });
    expect(stockForAset(ITEM_ID, "UNREADY", locations, stockByLoc)).toMatchObject({
      code: "STOK-UNREADY",
      qty: 0,
    });
  });
});

describe("stockShortageHint", () => {
  it("memberi peringatan bila qty melebihi stok lokasi pemotong", () => {
    const hint = stockShortageHint(5, "ASSET RETUR", { code: "STOK-RETUR", qty: 3 });
    expect(hint).toContain("melebihi stok STOK-RETUR");
    expect(hint).toContain("Kurang 2");
  });

  it("tidak memberi peringatan bila stok cukup", () => {
    expect(stockShortageHint(3, "ASSET RETUR", { code: "STOK-RETUR", qty: 3 })).toBeNull();
    expect(stockShortageHint(1, "ASSET BARU", { code: "STOK-BARU", qty: 99 })).toBeNull();
  });

  it("tidak memberi peringatan bila qty belum diisi", () => {
    expect(stockShortageHint(0, "ASSET BARU", { code: "STOK-BARU", qty: 0 })).toBeNull();
  });
});
