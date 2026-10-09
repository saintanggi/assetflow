import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatQty, formatRupiah, timeAgo } from "./format";

describe("formatDate", () => {
  it("memformat tanggal ke Bahasa Indonesia", () => {
    expect(formatDate("2026-10-09")).toBe("9 Okt 2026");
  });
  it("mengembalikan strip untuk nilai kosong/tidak valid", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("bukan-tanggal")).toBe("—");
  });
  it("menerima objek Date", () => {
    expect(formatDate(new Date(2026, 0, 1))).toBe("1 Jan 2026");
  });
});

describe("formatDateTime", () => {
  it("memformat tanggal + jam", () => {
    const s = formatDateTime("2026-10-09T16:46:00+07:00");
    expect(s).toContain("9 Okt 2026");
    expect(s).toMatch(/\d{2}\.\d{2}/);
  });
  it("mengembalikan strip untuk nilai kosong", () => {
    expect(formatDateTime(null)).toBe("—");
  });
});

describe("formatRupiah", () => {
  const norm = (s: string) => s.replace(/ /g, " ");
  it("memformat angka menjadi Rupiah tanpa desimal", () => {
    expect(norm(formatRupiah(1500000))).toBe("Rp 1.500.000");
    expect(norm(formatRupiah("2500"))).toBe("Rp 2.500");
  });
  it("mengembalikan strip untuk nilai kosong/tidak valid", () => {
    expect(formatRupiah(null)).toBe("—");
    expect(formatRupiah(undefined)).toBe("—");
    expect(formatRupiah("")).toBe("—");
    expect(formatRupiah(NaN)).toBe("—");
  });
  it("menerima nol", () => {
    expect(norm(formatRupiah(0))).toBe("Rp 0");
  });
});

describe("formatQty", () => {
  it("membuang nol desimal yang tidak perlu", () => {
    expect(formatQty(250.5)).toBe("250,5");
    expect(formatQty(100)).toBe("100");
  });
  it("mengembalikan strip untuk nilai kosong", () => {
    expect(formatQty(null)).toBe("—");
  });
});

describe("timeAgo", () => {
  it("menampilkan 'baru saja' untuk waktu kini", () => {
    expect(timeAgo(new Date())).toBe("baru saja");
  });
  it("menampilkan menit/jam/hari", () => {
    expect(timeAgo(new Date(Date.now() - 5 * 60000))).toBe("5 mnt lalu");
    expect(timeAgo(new Date(Date.now() - 3 * 3600000))).toBe("3 jam lalu");
    expect(timeAgo(new Date(Date.now() - 2 * 86400000))).toBe("2 hari lalu");
  });
});
