import { describe, expect, it } from "vitest";
import {
  describeItemChange,
  formatStockMoveResult,
  isMissingRpcError,
  needsStockMove,
  type ItemChangeInput,
} from "./itemCorrection";

const base: ItemChangeInput = {
  oldItemId: "item-monitor-set",
  newItemId: "item-monitor",
  oldStatus: "ASSET RETUR",
  newStatus: "ASSET RETUR",
  qtyShipped: 4,
};

describe("needsStockMove", () => {
  it("memindahkan stok saat barang berubah dan sudah ada yang terkirim", () => {
    expect(needsStockMove(base)).toBe(true);
  });

  it("memindahkan stok saat hanya Status Aset yang berubah", () => {
    expect(
      needsStockMove({ ...base, newItemId: base.oldItemId, newStatus: "ASSET BARU" })
    ).toBe(true);
  });

  it("tidak perlu memindahkan stok bila belum ada pengiriman", () => {
    expect(needsStockMove({ ...base, qtyShipped: 0 })).toBe(false);
  });

  it("tidak perlu memindahkan stok bila tidak ada yang berubah", () => {
    expect(
      needsStockMove({ ...base, newItemId: base.oldItemId, newStatus: base.oldStatus })
    ).toBe(false);
  });
});

describe("describeItemChange", () => {
  it("menyebut barang lama & baru beserta qty yang dipindahkan", () => {
    const text = describeItemChange({
      ...base,
      oldName: "MONITOR SET",
      newName: "MONITOR",
    });
    expect(text).toContain('"MONITOR SET" → "MONITOR"');
    expect(text).toContain("4 unit dikembalikan");
    expect(text).toContain("dipotong");
    expect(text).toContain("Log Transaksi");
  });

  it("menjelaskan perubahan Status Aset saja tanpa menyebut ganti barang", () => {
    const text = describeItemChange({
      ...base,
      newItemId: base.oldItemId,
      newStatus: "ASSET BARU",
      oldName: "MONITOR",
      newName: "MONITOR",
    });
    expect(text).toContain("Barang tetap");
    expect(text).toContain("ASSET RETUR → ASSET BARU");
    expect(text).not.toContain("Barang berubah");
  });
});

describe("isMissingRpcError", () => {
  it("mengenali fungsi RPC yang belum dipasang", () => {
    expect(
      isMissingRpcError(
        "Could not find the function public.admin_change_request_item(p_request_item_id, p_new_item_id, p_new_status_aset, p_reason) in the schema cache"
      )
    ).toBe(true);
    expect(isMissingRpcError("function public.admin_change_request_item does not exist")).toBe(
      true
    );
  });

  it("tidak menandai error lain", () => {
    expect(isMissingRpcError("Hanya Super Admin yang boleh mengubah barang")).toBe(false);
  });
});

describe("formatStockMoveResult", () => {
  it("merangkum perpindahan stok beserta nomor dokumen", () => {
    const msg = formatStockMoveResult({
      stock_move: {
        moved: true,
        qty: 4,
        from_item: "MONITOR SET",
        to_item: "MONITOR",
        from_location: "STOK-RETUR",
        to_location: "STOK-RETUR",
        in_doc: "SO-0001",
        out_doc: "SO-0002",
      },
    });
    expect(msg).toContain("Stok 4 unit dipindahkan");
    expect(msg).toContain("MONITOR SET (STOK-RETUR)");
    expect(msg).toContain("MONITOR (STOK-RETUR)");
    expect(msg).toContain("SO-0001 & SO-0002");
  });

  it("memakai pesan default saat tidak ada yang dipindahkan", () => {
    expect(formatStockMoveResult({ stock_move: null })).toContain("Belum ada stok");
    expect(formatStockMoveResult({ stock_move: { moved: false, note: "Tidak ada perubahan" } })).toBe(
      "Tidak ada perubahan"
    );
  });
});
