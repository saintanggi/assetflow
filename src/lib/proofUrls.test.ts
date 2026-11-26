import { describe, expect, it } from "vitest";
import { parseProofUrls, serializeProofUrls } from "./proofUrls";

describe("proofUrls", () => {
  it("parseProofUrls mengembalikan array kosong untuk null/undefined/string kosong", () => {
    expect(parseProofUrls(null)).toEqual([]);
    expect(parseProofUrls(undefined)).toEqual([]);
    expect(parseProofUrls("")).toEqual([]);
    expect(parseProofUrls("   ")).toEqual([]);
  });

  it("parseProofUrls menjaga kompatibilitas data lama (1 URL string polos atau path objek)", () => {
    const legacy =
      "https://vzkvmbydnwcjdthdqcdi.supabase.co/storage/v1/object/public/surat-jalan/a00a543a.png";
    expect(parseProofUrls(legacy)).toEqual([legacy]);
    expect(parseProofUrls("abc/sj-1.jpg")).toEqual(["abc/sj-1.jpg"]);
  });

  it("parseProofUrls membaca JSON array multi-URL dengan rapi", () => {
    const raw = JSON.stringify([
      "https://example.com/sj1.jpg",
      "  ",
      "https://example.com/sj2.png",
    ]);
    expect(parseProofUrls(raw)).toEqual([
      "https://example.com/sj1.jpg",
      "https://example.com/sj2.png",
    ]);
  });

  it("parseProofUrls aman saat JSON tidak valid", () => {
    expect(parseProofUrls("[rusak")).toEqual([]);
  });

  it("serializeProofUrls menyimpan 1 foto sebagai string polos dan ≥2 foto sebagai JSON array", () => {
    expect(serializeProofUrls([])).toBeNull();
    expect(serializeProofUrls(["  "])).toBeNull();
    expect(serializeProofUrls(["https://example.com/1.jpg"])).toBe(
      "https://example.com/1.jpg"
    );
    expect(
      serializeProofUrls([
        "https://example.com/1.jpg",
        "https://example.com/2.jpg",
        "https://example.com/1.jpg",
      ])
    ).toBe('["https://example.com/1.jpg","https://example.com/2.jpg"]');
  });
});
