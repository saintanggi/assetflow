// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  findLocationByCondition,
  isReadyConditionLocation,
  mainLocationCodeForCondition,
  normalizeCondition,
} from "./stockLocations";

describe("stockLocations helper", () => {
  const locs = [
    { id: "1", code: "CP-BARU" },
    { id: "2", code: "STOK-BARU" },
    { id: "3", code: "STOK-RETUR" },
    { id: "4", code: "STOK-UNREADY" },
  ];

  it("menormalisasi variasi penulisan status aset & jenis stok", () => {
    expect(normalizeCondition("ASSET BARU")).toBe("BARU");
    expect(normalizeCondition("baru")).toBe("BARU");
    expect(normalizeCondition("ASSET RETURN")).toBe("RETUR");
    expect(normalizeCondition("retur")).toBe("RETUR");
    expect(normalizeCondition("UNREADY")).toBe("UNREADY");
    expect(normalizeCondition(null)).toBe("BARU");
  });

  it("preferMain memilih STOK-* tepat tanpa fallback ke gudang lain", () => {
    expect(findLocationByCondition(locs, "ASSET BARU", { preferMain: true })?.id).toBe("2");
    expect(findLocationByCondition(locs, "ASSET RETUR", { preferMain: true })?.id).toBe("3");
    expect(
      findLocationByCondition([{ id: "1", code: "CP-BARU" }], "ASSET BARU", { preferMain: true })
    ).toBeNull();
  });

  it("non-preferMain mencocokkan suffix -BARU/-RETUR/-UNREADY tanpa fallback locations[0]", () => {
    const branchLocs = [
      { id: "a", code: "GDG2-BARU" },
      { id: "b", code: "GDG2-RETUR" },
    ];
    expect(findLocationByCondition(branchLocs, "ASSET BARU")?.id).toBe("a");
    expect(findLocationByCondition(branchLocs, "ASSET RETUR")?.id).toBe("b");
    expect(findLocationByCondition(branchLocs, "UNREADY")).toBeNull();
  });

  it("isReadyConditionLocation & mainLocationCodeForCondition konsisten", () => {
    expect(isReadyConditionLocation("STOK-BARU")).toBe(true);
    expect(isReadyConditionLocation("gdg2-baru")).toBe(true);
    expect(isReadyConditionLocation("STOK-RETUR")).toBe(false);
    expect(mainLocationCodeForCondition("UNREADY")).toBe("STOK-UNREADY");
  });
});
