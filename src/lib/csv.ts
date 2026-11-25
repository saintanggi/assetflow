/** Ekspor baris data menjadi file CSV (dengan BOM agar Excel membaca UTF-8).
 *  Dilengkapi proteksi CSV/Excel Formula Injection (=, +, -, @, TAB, CR). */

const FORMULA_TRIGGER = /^[=+\-@\t\r]/;
const PURE_SIGNED_NUMBER = /^[+-]?\d+(?:[.,]\d+)?$/;

export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  // Cegah formula injection di Excel (mis. "=cmd|...", "+HYPERLINK(...)")
  // sambil tetap membiarkan angka negatif/positif murni (mis. "-5", "-12.5").
  if (FORMULA_TRIGGER.test(s) && !PURE_SIGNED_NUMBER.test(s.trim())) {
    s = `'${s}`;
  }
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function exportToCsv(filename: string, rows: Record<string, unknown>[]): void {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0] ?? {});
  const lines = [
    headers.map(sanitizeCsvCell).join(","),
    ...rows.map((r) => headers.map((h) => sanitizeCsvCell(r[h])).join(",")),
  ];
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
