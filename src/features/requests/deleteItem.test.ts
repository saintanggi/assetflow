import { describe, expect, it } from "vitest";
import {
  describeItemDelete,
  formatDeleteItemResult,
} from "./deleteItem";

describe("describeItemDelete", () => {
  it("baris tanpa pengiriman menyebut tanpa dampak stok", () => {
    const text = describeItemDelete({
      name: "Kabel LAN 5m",
      qtyShipped: 0,
      locationCode: "STOK-BARU",
    });
    expect(text).toContain('"Kabel LAN 5m"');
    expect(text).toContain("belum ada yang terkirim");
    expect(text).toContain("tidak ada dampak ke stok");
    expect(text).not.toContain("koreksi IN");
  });

  it("baris terkirim menyebut qty, lokasi tujuan, dan koreksi IN", () => {
    const text = describeItemDelete({
      name: "MOUSE",
      qtyShipped: 2,
      locationCode: "STOK-RETUR",
    });
    expect(text).toContain('"MOUSE"');
    expect(text).toContain("sudah terkirim 2 unit");
    expect(text).toContain("STOK-RETUR");
    expect(text).toContain("koreksi IN");
    expect(text).toContain("Log Transaksi");
    expect(text).toContain("OUT lama tetap tersimpan");
  });
});

describe("formatDeleteItemResult", () => {
  it("tanpa pengembalian stok hanya menyebut baris terhapus", () => {
    const msg = formatDeleteItemResult(
      { ok: true, qty_restored: 0, in_doc: null, status: "selesai" },
      "MOUSE",
    );
    expect(msg).toContain('Baris "MOUSE" dihapus dari permintaan.');
    expect(msg).not.toContain("dikembalikan");
    expect(msg).toContain("Status tiket kini: Selesai.");
  });

  it("dengan pengembalian stok menyertakan qty dan nomor dokumen IN", () => {
    const msg = formatDeleteItemResult(
      { ok: true, qty_restored: 1, in_doc: "IN-2026-000012", status: "diproses" },
      "KOMPUTER RAKITAN",
    );
    expect(msg).toContain('Baris "KOMPUTER RAKITAN" dihapus dari permintaan.');
    expect(msg).toContain("Stok 1 unit dikembalikan (dokumen IN-2026-000012).");
    expect(msg).toContain("Status tiket kini: Diproses.");
  });

  it("status tak dikenal tidak membuat crash", () => {
    const msg = formatDeleteItemResult(
      { ok: true, qty_restored: 0, status: "hemmm" },
      "X",
    );
    expect(msg).toContain('Baris "X" dihapus dari permintaan.');
    expect(msg).not.toContain("Status tiket kini");
  });

  it("input null/undefined aman", () => {
    expect(formatDeleteItemResult(null, "X")).toContain(
      'Baris "X" dihapus dari permintaan.',
    );
  });
});
