/** Seluruh ukuran dalam mm; preview dan dokumen printer memakai kontrak yang sama. */
export const SERIAL_SHEET = { width: 100, height: 150, labelWidth: 20, labelHeight: 15, columns: 4 } as const;

export const SHEET_PRESETS = {
  photo: { rows: 6, marginX: 4, marginY: 10, gapX: 4, gapY: 8, title: "4 kolom × 6 baris · 24 label (seperti contoh)" },
  compact: { rows: 8, marginX: 4, marginY: 4.5, gapX: 4, gapY: 3, title: "4 kolom × 8 baris · 32 label (rapat)" },
} as const;
export type SheetPreset = keyof typeof SHEET_PRESETS;
export interface SerialSheetOptions { preset: SheetPreset; header: string }
export const DEFAULT_SHEET_OPTIONS: SerialSheetOptions = { preset: "photo", header: "SiCepat" };

export function resolveSheetOptions(options: SerialSheetOptions = DEFAULT_SHEET_OPTIONS): SerialSheetOptions {
  if (!Object.hasOwn(SHEET_PRESETS, options.preset) || typeof options.header !== "string" || options.header.trim().length > 24) {
    throw new Error("Pengaturan template label tidak valid");
  }
  return { preset: options.preset, header: options.header.trim() };
}

/** Urutan baca: kiri ke kanan, atas ke bawah, kemudian lembar berikutnya. */
export function serialSheetPages(codes: string[], options: SerialSheetOptions = DEFAULT_SHEET_OPTIONS): string[][] {
  const { preset } = resolveSheetOptions(options);
  if (!codes.length || codes.length > 500 || codes.some((code) => !/^\d{12}$/.test(code)) || new Set(codes).size !== codes.length) {
    throw new Error("Daftar nomor label tidak valid");
  }
  const sorted = [...codes].sort();
  const capacity = SERIAL_SHEET.columns * SHEET_PRESETS[preset].rows;
  const pages: string[][] = [];
  for (let start = 0; start < sorted.length; start += capacity) pages.push(sorted.slice(start, start + capacity));
  return pages;
}
