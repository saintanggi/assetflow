// Tes perbandingan file upload vs Google Sheet (dokumen pengiriman).
// Pengingat saja (bukan penghalang): selisih dilaporkan, upload tetap jalan.
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  SHIPPING_HEADERS,
  parseShippingSheet,
  type ParsedShippingRow,
} from "./shippingUpload";
import { compareUploadWithSheet, sheetDiffCount } from "./compareSheet";

/** Bangun baris ParsedShippingRow dari sheet seperti file "Dokumen Pengiriman". */
function readSheet(rows: (string | number | Date | "")[][]): ParsedShippingRow[] {
  const aoa: (string | number | Date | "")[][] = [[...SHIPPING_HEADERS], ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "PENGIRIMAN");
  const raw = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const wb2 = XLSX.read(raw, { cellDates: true });
  const aoaBack = XLSX.utils.sheet_to_json<unknown[]>(wb2.Sheets["PENGIRIMAN"], {
    header: 1,
    defval: "",
  });
  return parseShippingSheet(aoaBack).rows;
}

// Kolom: tanggal, tiket, gerai, kode gerai, nama barang, qty, ket, resi,
// barcode, type, status request, status aset, status terkirim.
const row = (
  ticket: string,
  item: string,
  qty: number | "",
  barcode: string,
  aset = "ASSET RETUR",
  terkirim = "TERKIRIM",
  date = "2026-11-18",
): (string | number)[] => [
  date, ticket, "Klaten Utara FM", "1401007", item, qty, "", "999007269981",
  barcode, "", "", aset, terkirim,
];

describe("compareUploadWithSheet", () => {
  it("file dan Sheet sama persis -> tidak ada selisih", () => {
    const file = readSheet([
      row("A2611171391", "PRINTER BARCODE_TTP-244 PRO", 1, "A1000012847"),
      row("A2611171391", "PRINTER BARCODE_TTP-244 PRO", "", "A1000012851"),
    ]);
    const sheet = readSheet([
      row("A2611171391", "PRINTER BARCODE_TTP-244 PRO", 1, "A1000012847"),
      row("A2611171391", "PRINTER BARCODE_TTP-244 PRO", "", "A1000012851"),
    ]);
    const d = compareUploadWithSheet(file, sheet);
    expect(sheetDiffCount(d)).toBe(0);
    expect(d.matchedLines).toBe(1);
    expect(d.totalQtyFile).toBe(2);
    expect(d.totalQtySheet).toBe(2);
  });

  it("nama beda kapital/underscore tetap dianggap sama", () => {
    const file = readSheet([
      row("A2611171391", "PRINTER BARCODE_TTP-244 PRO", 1, "A1000012847"),
    ]);
    const sheet = readSheet([
      row("A2611171391", "printer barcode ttp 244 pro", 1, "A1000012847"),
    ]);
    const d = compareUploadWithSheet(file, sheet);
    expect(sheetDiffCount(d)).toBe(0);
    expect(d.matchedLines).toBe(1);
  });

  it("baris hanya di file -> fileOnly; hanya di Sheet -> sheetOnly", () => {
    const file = readSheet([
      row("A2611171391", "PRINTER BARCODE_TTP-244 PRO", 1, "A1000012847"),
      row("A2611171392", "KIPAS ANGIN WALL 18\" REGENCY", 1, "K001"),
    ]);
    const sheet = readSheet([
      row("A2611171391", "PRINTER BARCODE_TTP-244 PRO", 1, "A1000012847"),
      row("A2611171393", "MOUSE KABEL", 1, "M001"),
    ]);
    const d = compareUploadWithSheet(file, sheet);
    expect(d.fileOnly).toHaveLength(1);
    expect(d.fileOnly[0].ticket).toBe("A2611171392");
    expect(d.sheetOnly).toHaveLength(1);
    expect(d.sheetOnly[0].ticket).toBe("A2611171393");
    expect(d.matchedLines).toBe(1);
  });

  it("qty beda untuk kunci yang sama -> qtyMismatch", () => {
    const file = readSheet([
      row("A2611171391", "PRINTER BARCODE_TTP-244 PRO", 2, "A1000012847"),
      row("A2611171391", "PRINTER BARCODE_TTP-244 PRO", "", "A1000012851"),
    ]);
    const sheet = readSheet([
      row("A2611171391", "PRINTER BARCODE_TTP-244 PRO", 1, "A1000012847"),
    ]);
    const d = compareUploadWithSheet(file, sheet);
    expect(d.qtyMismatch).toHaveLength(1);
    expect(d.qtyMismatch[0].qtyFile).toBe(2);
    expect(d.qtyMismatch[0].qtySheet).toBe(1);
    expect(d.barcodeMismatch).toHaveLength(0);
  });

  it("qty sama tapi barcode beda -> barcodeMismatch", () => {
    const file = readSheet([
      row("A2611171391", "PRINTER BARCODE_TTP-244 PRO", 1, "A1000012847"),
    ]);
    const sheet = readSheet([
      row("A2611171391", "PRINTER BARCODE_TTP-244 PRO", 1, "B9999999999"),
    ]);
    const d = compareUploadWithSheet(file, sheet);
    expect(d.qtyMismatch).toHaveLength(0);
    expect(d.barcodeMismatch).toHaveLength(1);
    expect(d.barcodeMismatch[0].onlyFile).toEqual(["A1000012847"]);
    expect(d.barcodeMismatch[0].onlySheet).toEqual(["B9999999999"]);
  });

  it("total qty sama tapi status PENDING beda -> statusMismatch", () => {
    const file = readSheet([
      row("A2611171391", "PRINTER BARCODE_TTP-244 PRO", 1, "A1000012847", "ASSET RETUR", "PENDING"),
    ]);
    const sheet = readSheet([
      row("A2611171391", "PRINTER BARCODE_TTP-244 PRO", 1, "A1000012847", "ASSET RETUR", "TERKIRIM"),
    ]);
    const d = compareUploadWithSheet(file, sheet);
    expect(d.qtyMismatch).toHaveLength(0);
    expect(d.statusMismatch).toHaveLength(1);
    expect(d.statusMismatch[0].pendingFile).toBe(1);
    expect(d.statusMismatch[0].pendingSheet).toBe(0);
  });

  it("blok QTY merge di file vs baris satuan di Sheet tetap cocok", () => {
    // File: 1 baris QTY 3 + 2 baris lanjutan (blok merge) = 3 unit.
    const file = readSheet([
      row("A2611171391", "KURSI TRAINING", 3, "K1"),
      row("A2611171391", "KURSI TRAINING", "", "K2"),
      row("A2611171391", "KURSI TRAINING", "", "K3"),
    ]);
    // Sheet: 3 baris satuan, masing-masing QTY 1.
    const sheet = readSheet([
      row("A2611171391", "KURSI TRAINING", 1, "K1"),
      row("A2611171391", "KURSI TRAINING", 1, "K2"),
      row("A2611171391", "KURSI TRAINING", 1, "K3"),
    ]);
    const d = compareUploadWithSheet(file, sheet);
    expect(sheetDiffCount(d)).toBe(0);
    expect(d.totalQtyFile).toBe(3);
    expect(d.totalQtySheet).toBe(3);
  });

  it("kondisi aset beda (BARU vs RETUR) dihitung baris berbeda", () => {
    const file = readSheet([
      row("A2611171391", "PRINTER BARCODE_TTP-244 PRO", 1, "A1000012847", "ASSET BARU"),
    ]);
    const sheet = readSheet([
      row("A2611171391", "PRINTER BARCODE_TTP-244 PRO", 1, "A1000012847", "ASSET RETUR"),
    ]);
    const d = compareUploadWithSheet(file, sheet);
    expect(d.fileOnly).toHaveLength(1);
    expect(d.sheetOnly).toHaveLength(1);
    expect(d.matchedLines).toBe(0);
  });

  it("file kosong vs Sheet berisi -> semua sheetOnly", () => {
    const d = compareUploadWithSheet(
      [],
      readSheet([row("A2611171391", "MOUSE KABEL", 2, "M001")]),
    );
    expect(d.fileOnly).toHaveLength(0);
    expect(d.sheetOnly).toHaveLength(1);
    expect(d.totalQtyFile).toBe(0);
    expect(d.totalQtySheet).toBe(2);
  });
});
