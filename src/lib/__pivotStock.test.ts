import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  PIVOT_MAX_DAYS,
  buildPivotSeries,
  buildPivotWorkbook,
  eachDay,
  kindOf,
  type PivotBalance,
  type PivotItemInfo,
  type PivotMove,
  type PivotRow,
} from "./pivotStock";

describe("eachDay", () => {
  it("menghasilkan semua tanggal inklusif", () => {
    expect(eachDay("2026-11-01", "2026-11-03")).toEqual([
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
    ]);
    expect(eachDay("2026-11-11", "2026-11-11")).toEqual(["2026-11-11"]);
    expect(eachDay("2026-10-30", "2026-11-02")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
  });
});

describe("kindOf", () => {
  it("memilah dari akhiran kode lokasi", () => {
    expect(kindOf("STOK-BARU")).toBe("baru");
    expect(kindOf("CEMPAKA_PUTIH-BARU")).toBe("baru");
    expect(kindOf("STOK-RETUR")).toBe("retur");
    expect(kindOf("STOK-UNREADY")).toBe("unready");
    expect(kindOf("RAK-A1")).toBe("unready");
  });
});

const info = new Map<string, PivotItemInfo>([
  [
    "item-a|loc-retur",
    {
      sku: "BRG-0031",
      name: "CPU Rakitan",
      unit: "PCS",
      buffer: 2,
      locCode: "STOK-RETUR",
      locName: "STOK-RETUR",
    },
  ],
  [
    "item-b|loc-baru",
    {
      sku: "BRG-0009",
      name: "Camera CCTV Indoor",
      unit: "PCS",
      buffer: 0,
      locCode: "STOK-BARU",
      locName: "STOK-BARU",
    },
  ],
  [
    "item-c|loc-retur",
    {
      sku: "BRG-9999",
      name: "Barang Nol",
      unit: "PCS",
      buffer: 0,
      locCode: "STOK-RETUR",
      locName: "STOK-RETUR",
    },
  ],
]);

describe("buildPivotSeries", () => {
  it("stok akhir per tanggal = saldo kini − mutasi setelah tanggal itu", () => {
    const balances: PivotBalance[] = [
      { item_id: "item-a", location_id: "loc-retur", qty: 20, opening: 11 },
      { item_id: "item-b", location_id: "loc-baru", qty: 5, opening: 5 },
    ];
    const moves: PivotMove[] = [
      { item_id: "item-a", location_id: "loc-retur", qty_change: 5, txnDate: "2026-11-02" },
      { item_id: "item-a", location_id: "loc-retur", qty_change: -3, txnDate: "2026-11-04" },
      { item_id: "item-a", location_id: "loc-retur", qty_change: -2, txnDate: "2026-11-04" },
      { item_id: "item-a", location_id: "loc-retur", qty_change: 4, txnDate: "2026-11-06" },
      // Sebelum periode: sudah tercermin di saldo, tidak mengurangi tanggal mana pun.
      { item_id: "item-a", location_id: "loc-retur", qty_change: -2, txnDate: "2026-10-31" },
      // Setelah periode: belum masuk ke tanggal mana pun di periode.
      { item_id: "item-a", location_id: "loc-retur", qty_change: 7, txnDate: "2026-11-09" },
    ];
    const dates = eachDay("2026-11-01", "2026-11-07");
    const rows = buildPivotSeries(balances, moves, dates, info);
    const a = rows.find((r) => r.sku === "BRG-0031")!;
    // end(D) = 20 − mutasi bertanggal > D:
    // 11-01: 20−(5−3−2+4+7)=9 | 11-02: 20−(−3−2+4+7)=14 | 11-03: 14
    // 11-04: 20−(4+7)=9 | 11-05: 9 | 11-06: 20−7=13 | 11-07: 13
    expect(a.daily).toEqual([9, 14, 14, 9, 9, 13, 13]);
    // Barang tanpa mutasi: garis datar = saldo kini.
    const b = rows.find((r) => r.sku === "BRG-0009")!;
    expect(b.daily).toEqual([5, 5, 5, 5, 5, 5, 5]);
    // Riwayat rekonsiliasi: saldo awal 11 + mutasi 9 = saldo kini 20.
    expect(a.reconciled).toBe(true);
    expect(b.reconciled).toBe(true);
  });

  it("menandai baris yang riwayatnya tidak rekonsiliasi (edit tanpa jejak)", () => {
    // Kasus nyata CPU Rakitan 11 Nov 2026: saldo awal (terkoreksi) 7 +
    // mutasi +18 = 25, tapi saldo kini 16 — selisih 9 dari Atur Stok tanpa jejak.
    const balances: PivotBalance[] = [
      { item_id: "item-a", location_id: "loc-retur", qty: 16, opening: 7 },
    ];
    const moves: PivotMove[] = [
      { item_id: "item-a", location_id: "loc-retur", qty_change: 18, txnDate: "2026-11-05" },
      { item_id: "item-a", location_id: "loc-retur", qty_change: -9, txnDate: "2026-11-10" },
      { item_id: "item-a", location_id: "loc-retur", qty_change: 9, txnDate: "2026-11-11" },
    ];
    const rows = buildPivotSeries(
      balances,
      moves,
      eachDay("2026-11-01", "2026-11-03"),
      info,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].reconciled).toBe(false);
  });

  it("membuang baris yang nol di semua tanggal", () => {
    const balances: PivotBalance[] = [
      { item_id: "item-c", location_id: "loc-retur", qty: 0, opening: 0 },
    ];
    const rows = buildPivotSeries(
      balances,
      [],
      eachDay("2026-11-01", "2026-11-03"),
      info,
    );
    expect(rows).toEqual([]);
  });

  it("mutasi setelah tanggal akhir tidak masuk ke stok akhir periode", () => {
    const balances: PivotBalance[] = [
      { item_id: "item-a", location_id: "loc-retur", qty: 16, opening: 8 },
    ];
    const moves: PivotMove[] = [
      // Koreksi +9 bertanggal 11 Nov: untuk periode s/d 10 Nov tidak boleh masuk.
      { item_id: "item-a", location_id: "loc-retur", qty_change: 9, txnDate: "2026-11-11" },
      { item_id: "item-a", location_id: "loc-retur", qty_change: -1, txnDate: "2026-11-10" },
    ];
    const rows = buildPivotSeries(
      balances,
      moves,
      eachDay("2026-11-09", "2026-11-10"),
      info,
    );
    const a = rows.find((r) => r.sku === "BRG-0031")!;
    // 11-09: 16-(9-1)=8 ; 11-10: 16-9=7
    expect(a.daily).toEqual([8, 7]);
  });
});

describe("buildPivotWorkbook", () => {
  const dates = eachDay("2026-11-01", "2026-11-03");
  const rows: PivotRow[] = [
    {
      sku: "BRG-0031",
      item: "CPU Rakitan",
      unit: "PCS",
      buffer: 2,
      location: "STOK-RETUR",
      locCode: "STOK-RETUR",
      daily: [7, 6, 6],
      reconciled: true,
    },
    {
      sku: "BRG-0009",
      item: "Camera CCTV Indoor",
      unit: "PCS",
      buffer: 0,
      location: "STOK-BARU",
      locCode: "STOK-BARU",
      daily: [10, 12, 12],
      reconciled: true,
    },
  ];

  it("membuat sheet Ringkasan + Barang Baru + Return (tanpa Unready bila kosong)", () => {
    const wb = buildPivotWorkbook({
      rows,
      dates,
      whName: "Gudang Utama",
      startDate: "2026-11-01",
      endDate: "2026-11-03",
    });
    expect(wb.SheetNames).toEqual(["Ringkasan", "Barang Baru", "Return"]);
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const back = XLSX.read(buf, { type: "buffer" });
    expect(back.SheetNames).toEqual(["Ringkasan", "Barang Baru", "Return"]);

    const ws = back.Sheets["Return"];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][];
    expect(aoa[0]).toEqual([
      "NO",
      "SKU",
      "Item",
      "Satuan",
      "BUFFER",
      "Lokasi",
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
    ]);
    expect(aoa[1]).toEqual([1, "BRG-0031", "CPU Rakitan", "PCS", 2, "STOK-RETUR", 7, 6, 6]);
    expect(aoa[2][2]).toBe("TOTAL");
    expect(aoa[2].slice(6)).toEqual([7, 6, 6]);
    // Nilai tanggal berupa angka asli, bukan teks.
    expect(typeof aoa[1][6]).toBe("number");

    const ring = XLSX.utils.sheet_to_json(back.Sheets["Ringkasan"], {
      header: 1,
    }) as unknown[][];
    expect(ring[0][0]).toBe("Laporan Stok Pivot");
    expect(ring[6]).toEqual(["Barang Baru", 1, 12]);
    expect(ring[7]).toEqual(["Return", 1, 6]);
    expect(ring[8]).toEqual(["TOTAL", 2, 18]);
  });

  it("menulis catatan rekonsiliasi bila ada baris yang tidak nyambung", () => {
    const bad: PivotRow[] = [
      { ...rows[0], reconciled: false },
      rows[1],
    ];
    const wb = buildPivotWorkbook({
      rows: bad,
      dates,
      whName: "Gudang Utama",
      startDate: "2026-11-01",
      endDate: "2026-11-03",
    });
    const ring = XLSX.utils.sheet_to_json(wb.Sheets["Ringkasan"], {
      header: 1,
    }) as unknown[][];
    const note = ring.find(
      (r) => typeof r[0] === "string" && r[0].startsWith("Catatan:"),
    );
    expect(note).toBeDefined();
    expect(
      ring.some((r) => r[0] === "BRG-0031 — CPU Rakitan (STOK-RETUR)"),
    ).toBe(true);
  });

  it("batas rentang 92 hari", () => {
    expect(PIVOT_MAX_DAYS).toBe(92);
    expect(eachDay("2026-11-01", "2026-11-03").length).toBeLessThanOrEqual(
      PIVOT_MAX_DAYS,
    );
  });
});
