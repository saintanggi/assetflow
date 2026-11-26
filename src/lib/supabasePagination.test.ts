import { describe, expect, it } from "vitest";
import { chunkArray, fetchAllPages } from "./supabasePagination";

describe("supabasePagination", () => {
  it("fetchAllPages menarik seluruh halaman melewati batas 1.000 baris PostgREST", async () => {
    const total = Array.from({ length: 2350 }, (_, i) => ({ id: i + 1 }));
    const calls: [number, number][] = [];

    const result = await fetchAllPages<{ id: number }>(async (from, to) => {
      calls.push([from, to]);
      return { data: total.slice(from, to + 1), error: null };
    });

    expect(result).toHaveLength(2350);
    expect(result[0].id).toBe(1);
    expect(result[2349].id).toBe(2350);
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("fetchAllPages bisa menarik puluhan ribu baris (>25.000) untuk pemakaian jangka panjang", async () => {
    const total = 32_500;
    const result = await fetchAllPages<{ idx: number }>(async (from, to) => {
      const len = Math.max(0, Math.min(to + 1, total) - from);
      return {
        data: Array.from({ length: len }, (_, k) => ({ idx: from + k })),
        error: null,
      };
    });

    expect(result).toHaveLength(32_500);
    expect(result[32_499].idx).toBe(32_499);
  });

  it("chunkArray memecah array besar ke batch aman untuk query .in(...)", () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
    const chunks = chunkArray(ids, 100);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(100);
    expect(chunks[1]).toHaveLength(100);
    expect(chunks[2]).toHaveLength(50);
  });
});
