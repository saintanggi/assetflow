/** Util format tanggal & angka Bahasa Indonesia. */

const idLocale = "id-ID";

/**
 * Tanggal hari ini menurut zona waktu LOKAL (mis. Asia/Jakarta), 'YYYY-MM-DD'.
 * Jangan memakai `new Date().toISOString().slice(0,10)` untuk tanggal bisnis:
 * itu UTC, sehingga antara 00:00–07:00 WIB tanggalnya masih kemarin dan
 * transaksi/permintaan tercatat di tanggal yang salah.
 */
export function todayLocalDate(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(idLocale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(idLocale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** Format Rupiah tanpa desimal, mis. Rp1.500.000 */
export function formatRupiah(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(idLocale, {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

/** Format kuantitas: buang nol desimal yang tidak perlu (250.500 → "250,5"). */
export function formatQty(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(idLocale, { maximumFractionDigits: 3 }).format(n);
}

export function timeAgo(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  const menit = Math.floor(diffMs / 60000);
  if (menit < 1) return "baru saja";
  if (menit < 60) return `${menit} mnt lalu`;
  const jam = Math.floor(menit / 60);
  if (jam < 24) return `${jam} jam lalu`;
  const hari = Math.floor(jam / 24);
  if (hari < 30) return `${hari} hari lalu`;
  return formatDate(d);
}

/**
 * Buat pola LIKE untuk pencarian barang yang toleran terhadap:
 * - huruf kapital (via ilike di query)
 * - spasi vs underscore (keduanya jadi wildcard %)
 * Contoh: "ac indoor" → "%ac%indoor%" cocok dengan "AC_Indoor_1.5_PK_Daikin".
 */
export function buildSearchPattern(q: string): string {
  const cleaned = q.replace(/[%]/g, "").trim().replace(/[\s_]+/g, "%");
  return `%${cleaned}%`;
}
