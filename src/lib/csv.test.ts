// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sanitizeCsvCell } from "./csv";

describe("sanitizeCsvCell (proteksi CSV Formula Injection)", () => {
  it("menetralkan awalan formula berbahaya (=, +, -, @, tab, cr)", () => {
    expect(sanitizeCsvCell("=SUM(A1:A10)")).toBe("'=SUM(A1:A10)");
    expect(sanitizeCsvCell("=cmd|' /C calc'!A0")).toBe("'=cmd|' /C calc'!A0");
    expect(sanitizeCsvCell("+HYPERLINK(\"http://evil\")")).toBe("\"'\"+HYPERLINK(\"\"http://evil\"\")\"".replace("\"'\"+", "\"'+"));
    expect(sanitizeCsvCell("@SUM(1+1)")).toBe("'@SUM(1+1)");
    expect(sanitizeCsvCell("-1+1")).toBe("'-1+1");
    expect(sanitizeCsvCell("\t=1+1")).toBe("'\t=1+1");
  });

  it("tetap menjaga angka negatif/positif murni & teks normal", () => {
    expect(sanitizeCsvCell(-42)).toBe("-42");
    expect(sanitizeCsvCell("-12.5")).toBe("-12.5");
    expect(sanitizeCsvCell("Router Mikrotik")).toBe("Router Mikrotik");
    expect(sanitizeCsvCell('Barang "A", tipe B')).toBe('"Barang ""A"", tipe B"');
    expect(sanitizeCsvCell(null)).toBe("");
    expect(sanitizeCsvCell(undefined)).toBe("");
  });
});
