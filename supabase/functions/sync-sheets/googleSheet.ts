// Unduh Google Sheet sebagai XLSX tanpa API key.
// Syarat: file di-share "Anyone with the link → Viewer" (atau dipublikasikan).
// Catatan: file gabungan (satu sheet per tanggal) HARUS diunduh sebagai XLSX
// supaya semua sheet bisa dibaca; endpoint CSV/gviz hanya memberi satu sheet.

import * as XLSX from "./xlsx.ts";

/** Ambil ID spreadsheet dari URL lengkap atau ID mentah. */
export function extractSpreadsheetId(input: string): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  const url = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]{20,})/);
  if (url) return url[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(raw)) return raw;
  return null;
}

export async function downloadWorkbook(spreadsheetId: string): Promise<XLSX.WorkBook> {
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`;
  const res = await fetch(url, { redirect: "follow" });
  const contentType = res.headers.get("content-type") ?? "";
  const body = new Uint8Array(await res.arrayBuffer());

  if (!res.ok || contentType.includes("text/html")) {
    throw new Error(
      "File Google Sheet tidak bisa diunduh. Pastikan sharing diatur " +
        '"Anyone with the link → Viewer" (Bagikan → Siapa saja yang memiliki link → Pelihat), ' +
        "lalu coba lagi."
    );
  }
  try {
    return XLSX.read(body, { cellDates: true });
  } catch {
    throw new Error("Isi file bukan Excel yang valid (mungkin link salah atau file diproteksi).");
  }
}
