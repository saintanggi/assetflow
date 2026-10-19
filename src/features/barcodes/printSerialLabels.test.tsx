import { describe, expect, it } from "vitest";
import { serialPrintDocument } from "./printSerialLabels";
import { DEFAULT_SHEET_OPTIONS, SERIAL_SHEET, SHEET_PRESETS, serialSheetPages } from "./serialSheetLayout";

const codes = (count: number) => Array.from({ length: count }, (_, n) => String(n + 1).padStart(12, "0"));
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const numbers = (doc: ParentNode) => [...doc.querySelectorAll(".serial-label-number")].map((el) => el.textContent);

describe("template kertas label 100 × 150 mm", () => {
  it("ukuran media dan label terpisah: nama, QR vektor, nomor dan bingkai", () => {
    const html = serialPrintDocument(codes(2));
    const doc = parse(html);
    expect(doc.querySelectorAll("svg")).toHaveLength(2);
    expect(doc.querySelectorAll(".serial-label-sheet")).toHaveLength(1);
    expect(doc.querySelectorAll(".serial-qr-label")).toHaveLength(2);
    expect(numbers(doc)).toEqual(codes(2));
    expect(doc.querySelector(".serial-label-header")?.textContent).toBe("SiCepat");
    expect(html).toContain("size:100mm 150mm;margin:0");
    expect(html).toContain("width:20mm;height:15mm");
    expect(html).toContain("border:0.2mm solid black");
    expect(html).toContain("grid-template-columns:repeat(4, 20mm)");
    expect(html).toContain("grid-template-rows:repeat(6, 15mm)");
    expect(html).not.toContain("<script");
  });

  it.each([1, 23, 24, 25, 48, 49, 500])("%i nomor: maksimal 24 per lembar, tanpa nomor hilang/dobel atau lembar kosong ekstra", (count) => {
    const doc = parse(serialPrintDocument(codes(count).reverse()));
    const sheets = [...doc.querySelectorAll(".serial-label-sheet")];
    expect(sheets).toHaveLength(Math.ceil(count / 24));
    expect(numbers(doc)).toEqual(codes(count));
    expect(new Set(numbers(doc)).size).toBe(count);
    sheets.forEach((sheet, n) => {
      expect(numbers(sheet)).toEqual(codes(count).slice(n * 24, n * 24 + 24));
    });
  });

  it("preset rapat memuat 32 label, halaman berikutnya mulai nomor 33", () => {
    const doc = parse(serialPrintDocument(codes(33), { preset: "compact", header: "ASSET" }));
    const sheets = doc.querySelectorAll(".serial-label-sheet");
    expect(sheets).toHaveLength(2);
    expect(sheets[0].querySelectorAll(".serial-qr-label")).toHaveLength(32);
    expect(numbers(sheets[1])).toEqual(["000000000033"]);
    expect(sheets[0].getAttribute("style")).toContain("repeat(8, 15mm)");
    expect(doc.querySelector(".serial-label-header")?.textContent).toBe("ASSET");
  });

  it("semua preset tepat muat di dalam kertas, label tidak diskalakan", () => {
    for (const layout of Object.values(SHEET_PRESETS)) {
      expect(2 * layout.marginX + SERIAL_SHEET.columns * SERIAL_SHEET.labelWidth + (SERIAL_SHEET.columns - 1) * layout.gapX).toBe(SERIAL_SHEET.width);
      expect(2 * layout.marginY + layout.rows * SERIAL_SHEET.labelHeight + (layout.rows - 1) * layout.gapY).toBe(SERIAL_SHEET.height);
    }
  });

  it("urutan kiri ke kanan lalu baris berikutnya, tidak memodifikasi array nomor asal", () => {
    const input = codes(25).reverse();
    const original = [...input];
    const pages = serialSheetPages(input);
    expect(pages[0].slice(0, 4)).toEqual(codes(4));
    expect(pages[0][4]).toBe("000000000005");
    expect(pages[1][0]).toBe("000000000025");
    expect(input).toEqual(original);
  });

  it("nama dikonversi sebagai teks, bukan HTML / script", () => {
    const doc = parse(serialPrintDocument(codes(1), { ...DEFAULT_SHEET_OPTIONS, header: "<script>x</script>" }));
    expect(doc.querySelector("script")).toBeNull();
    expect(doc.querySelector(".serial-label-header")?.textContent).toBe("<script>x</script>");
  });

  it("menolak daftar kosong, berlebihan, duplikat, dan konten bukan nomor", () => {
    for (const invalid of [[], ["<script>"], ["1"], Array(501).fill("000000000001"), ["000000000001", "000000000001"]]) {
      expect(() => serialPrintDocument(invalid)).toThrow("Daftar nomor label tidak valid");
    }
    expect(() => serialPrintDocument(codes(1), { preset: "unknown" as "photo", header: "" })).toThrow();
    expect(() => serialPrintDocument(codes(1), { preset: "photo", header: "A".repeat(25) })).toThrow();
  });
});
