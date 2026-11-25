/**
 * Sumber kebenaran tunggal untuk pemetaan kondisi stok (ASSET BARU / ASSET RETUR / UNREADY)
 * ke kode & suffix lokasi gudang (*-BARU / *-RETUR / *-UNREADY).
 *
 * Kompatibel 100% dengan kode lokasi Gudang Utama eksisting (`STOK-BARU`, `STOK-RETUR`,
 * `STOK-UNREADY`) sekaligus mendukung gudang tambahan multi-lokasi (`GDG2-BARU`, dst.)
 * tanpa pernah jatuh ke fallback acak `locations[0]`.
 */
import type { ExcelStatusAset } from "../types/database";

export type StockCondition = "BARU" | "RETUR" | "UNREADY";

export interface LocationLike {
  code?: string | null;
  warehouse_id?: string | null;
}

const SUFFIX_BY_COND: Record<StockCondition, string> = {
  BARU: "-BARU",
  RETUR: "-RETUR",
  UNREADY: "-UNREADY",
};

const MAIN_CODE_BY_COND: Record<StockCondition, string> = {
  BARU: "STOK-BARU",
  RETUR: "STOK-RETUR",
  UNREADY: "STOK-UNREADY",
};

const STATUS_ASET_BY_COND: Record<StockCondition, ExcelStatusAset> = {
  BARU: "ASSET BARU",
  RETUR: "ASSET RETUR",
  UNREADY: "UNREADY",
};

/** Normalisasi teks bebas (status_aset / jenis stok) menjadi kondisi baku. */
export function normalizeCondition(raw?: string | null): StockCondition {
  const upper = (raw ?? "").toUpperCase();
  if (upper.includes("UNREADY")) return "UNREADY";
  if (upper.includes("RETUR") || upper.includes("RETURN")) return "RETUR";
  return "BARU";
}

export function conditionToStatusAset(cond: StockCondition): ExcelStatusAset {
  return STATUS_ASET_BY_COND[cond];
}

export function conditionSuffix(cond: StockCondition): string {
  return SUFFIX_BY_COND[cond];
}

export function mainLocationCodeForCondition(cond: StockCondition): string {
  return MAIN_CODE_BY_COND[cond];
}

/** True bila kode lokasi mewakili stok siap pakai (berakhiran -BARU). */
export function isReadyConditionLocation(code?: string | null): boolean {
  return (code ?? "").trim().toUpperCase().endsWith("-BARU");
}

/**
 * Cari lokasi yang cocok dengan kondisi stok tertentu.
 * - Jika `preferMain = true`: cari kode tepat `STOK-{KONDISI}` dulu (Gudang Utama),
 *   dan TIDAK fallback ke gudang cabang lain jika tidak ditemukan.
 * - Jika `preferMain = false`: cari lokasi dalam daftar (biasanya sudah difilter
 *   per gudang) yang berakhiran `-{KONDISI}`. Tidak pernah fallback ke `locations[0]`.
 */
export function findLocationByCondition<T extends LocationLike>(
  locations: readonly T[],
  conditionOrStatus: string | null | undefined,
  opts?: { preferMain?: boolean }
): T | null {
  if (locations.length === 0) return null;
  const cond = normalizeCondition(conditionOrStatus);
  const mainCode = MAIN_CODE_BY_COND[cond];
  if (opts?.preferMain) {
    return (
      locations.find((l) => (l.code ?? "").trim().toUpperCase() === mainCode) ?? null
    );
  }
  const suffix = SUFFIX_BY_COND[cond];
  return (
    locations.find((l) => (l.code ?? "").trim().toUpperCase().endsWith(suffix)) ?? null
  );
}
