import { describe, expect, it } from "vitest";
import {
  formatRequestStatus,
  isKnownStatusAset,
  parseRequestStatus,
  parseStatusAset,
  statusRequestFromNotes,
  withStatusRequestInNotes,
} from "./requestStatus";

describe("parseRequestStatus", () => {
  it("membaca PINJAM beserta durasinya", () => {
    expect(parseRequestStatus("PINJAM 1 MINGGU")).toEqual({ status: "PINJAM", durasi: "1 MINGGU" });
    expect(parseRequestStatus("pinjam 2 minggu")).toEqual({ status: "PINJAM", durasi: "2 MINGGU" });
  });

  it("membaca PENAMBAHAN dan PERGANTIAN", () => {
    expect(parseRequestStatus("PENAMBAHAN")).toEqual({ status: "PENAMBAHAN", durasi: "" });
    expect(parseRequestStatus("Pergantian")).toEqual({ status: "PERGANTIAN", durasi: "" });
  });

  it("nilai kosong jatuh ke PENAMBAHAN", () => {
    expect(parseRequestStatus("")).toEqual({ status: "PENAMBAHAN", durasi: "" });
    expect(parseRequestStatus(null)).toEqual({ status: "PENAMBAHAN", durasi: "" });
  });

  it("nilai di luar aturan tidak membuat dropdown kosong", () => {
    expect(parseRequestStatus("PINJAM SAMPAI BULAN DEPAN").status).toBe("PINJAM");
    expect(parseRequestStatus("LAIN-LAIN").status).toBe("PENAMBAHAN");
  });
});

describe("formatRequestStatus", () => {
  it("menggabungkan status dan durasi", () => {
    expect(formatRequestStatus({ status: "PINJAM", durasi: "1 minggu" })).toBe("PINJAM 1 MINGGU");
    expect(formatRequestStatus({ status: "PINJAM", durasi: "" })).toBe("PINJAM");
    expect(formatRequestStatus({ status: "PERGANTIAN", durasi: "1 MINGGU" })).toBe("PERGANTIAN");
  });
});

describe("parseStatusAset", () => {
  it("mengenali berbagai penulisan status aset", () => {
    expect(parseStatusAset("ASSET BARU")).toBe("ASSET BARU");
    expect(parseStatusAset("baru")).toBe("ASSET BARU");
    expect(parseStatusAset("ASSET RETUR")).toBe("ASSET RETUR");
    expect(parseStatusAset("ASSET RETURN")).toBe("ASSET RETUR");
    expect(parseStatusAset("retur")).toBe("ASSET RETUR");
    expect(parseStatusAset("UNREADY")).toBe("UNREADY");
    expect(parseStatusAset(" ASSET  RETUR ")).toBe("ASSET RETUR");
  });

  it("nilai kosong/tak dikenal jatuh ke ASSET BARU", () => {
    expect(parseStatusAset("")).toBe("ASSET BARU");
    expect(parseStatusAset(null)).toBe("ASSET BARU");
    expect(parseStatusAset("ABC")).toBe("ASSET BARU");
  });

  it("isKnownStatusAset hanya true untuk nilai kanonis", () => {
    expect(isKnownStatusAset("ASSET RETUR")).toBe(true);
    expect(isKnownStatusAset("UNREADY")).toBe(true);
    expect(isKnownStatusAset("retur")).toBe(false);
  });
});

describe("notes", () => {
  it("mengambil baris Status request", () => {
    expect(statusRequestFromNotes("Ket: SN1\nStatus request: PINJAM 1 MINGGU")).toBe(
      "PINJAM 1 MINGGU"
    );
    expect(statusRequestFromNotes("Ket: SN1")).toBeNull();
  });

  it("menulis ulang Status request tanpa menghapus baris lain", () => {
    const out = withStatusRequestInNotes("Ket: SN1\nKet: SN2", { status: "PERGANTIAN", durasi: "" });
    expect(out).toBe("Ket: SN1\nKet: SN2\nStatus request: PERGANTIAN");
  });

  it("mengganti Status request yang sudah ada (tidak dobel)", () => {
    const out = withStatusRequestInNotes("Status request: PINJAM 1 MINGGU\nKet: SN1", {
      status: "PINJAM",
      durasi: "2 MINGGU",
    });
    expect(out).toBe("Ket: SN1\nStatus request: PINJAM 2 MINGGU");
  });
});
