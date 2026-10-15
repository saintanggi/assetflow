/**
 * Normalisasi Status Request & Status Asset.
 *
 * Status Request disimpan di dalam `request_items.notes`
 * dengan format satu baris: `Status request: <NILAI>`.
 * Status Asset disimpan di kolom `request_items.status_aset`
 * dengan nilai kanonis: ASSET BARU / ASSET RETUR / UNREADY.
 *
 * Nilai kanonis penting karena lokasi stok yang dipotong saat barang
 * terkirim ditentukan dari Status Asset (lihat `kondisiOf` di shippingUpload).
 */
import {
  EXCEL_STATUS_ASET,
  STATUS_REQUEST_OPTIONS,
  type ExcelStatusAset,
  type StatusRequest,
} from "../types/database";

export interface RequestStatusValue {
  /** Salah satu dari PENAMBAHAN / PERGANTIAN / PINJAM. */
  status: StatusRequest;
  /** Hanya untuk PINJAM, mis. "1 MINGGU". */
  durasi: string;
}

const norm = (v: string): string => v.trim().toUpperCase().replace(/\s+/g, " ");

/**
 * Baca nilai Status Request dari teks bebas (notes / isian Excel).
 * Contoh: "PINJAM 1 MINGGU" -> { status: "PINJAM", durasi: "1 MINGGU" }
 *         "Pergantian"      -> { status: "PERGANTIAN", durasi: "" }
 */
export function parseRequestStatus(raw: string | null | undefined): RequestStatusValue {
  const s = norm(raw ?? "");
  if (!s) return { status: "PENAMBAHAN", durasi: "" };

  for (const opt of STATUS_REQUEST_OPTIONS) {
    if (s === opt) return { status: opt, durasi: "" };
    if (s.startsWith(opt + " ")) {
      return { status: opt, durasi: s.slice(opt.length).trim() };
    }
  }
  // Nilai di luar aturan: tetap tampilkan, tapi dipetakan ke PENAMBAHAN
  // supaya dropdown tidak pernah kosong. Sisa teks disimpan sebagai durasi
  // hanya bila mengandung kata PINJAM.
  if (s.includes("PINJAM")) {
    return { status: "PINJAM", durasi: s.replace(/^.*PINJAM/, "").trim() };
  }
  return { status: "PENAMBAHAN", durasi: "" };
}

/** Gabungkan status + durasi menjadi satu nilai siap simpan. */
export function formatRequestStatus(v: RequestStatusValue): string {
  if (v.status === "PINJAM") {
    return v.durasi.trim() ? `PINJAM ${v.durasi.trim().toUpperCase()}` : "PINJAM";
  }
  return v.status;
}

/**
 * Normalisasi Status Asset ke nilai kanonis.
 * Menerima variasi penulisan: "RETUR", "RETURN", "ASSET RETURN", "baru", dll.
 */
export function parseStatusAset(raw: string | null | undefined): ExcelStatusAset {
  const s = norm(raw ?? "");
  if (!s) return "ASSET BARU";
  if (s.includes("UNREADY")) return "UNREADY";
  if (s.includes("RETUR") || s.includes("RETURN")) return "ASSET RETUR";
  if (s.includes("BARU") || s.includes("NEW")) return "ASSET BARU";
  // Nilai tak dikenal: kembalikan default aman.
  return "ASSET BARU";
}

/** true bila nilai sudah termasuk pilihan yang diizinkan. */
export function isKnownStatusAset(raw: string | null | undefined): boolean {
  const s = norm(raw ?? "");
  return (EXCEL_STATUS_ASET as readonly string[]).includes(s);
}

/** Ambil baris `Status request: …` dari notes (bila ada). */
export function statusRequestFromNotes(notes: string | null | undefined): string | null {
  for (const line of (notes ?? "").split("\n")) {
    const m = line.match(/^Status request:\s*(.+)$/i);
    if (m) return m[1].trim();
  }
  return null;
}

/**
 * Tulis ulang baris `Status request: …` di dalam notes.
 * Baris lain (mis. "Ket: …" atau keterangan bebas) tetap dipertahankan.
 */
export function withStatusRequestInNotes(
  notes: string | null | undefined,
  value: RequestStatusValue
): string {
  const lines = (notes ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^Status request:/i.test(l));
  lines.push(`Status request: ${formatRequestStatus(value)}`);
  return lines.join("\n");
}
