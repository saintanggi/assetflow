// =============================================================================
// Logika baca & agregasi file "Dokumen Pengiriman" (menu Upload Dokumen).
//
// Dipisah dari komponen halaman supaya bisa diuji (src/lib/shippingUpload.test.ts).
//
// Perbaikan bug penting yang ditangani di sini:
// 1. QTY membengkak (contoh nyata: 23 jadi 45).
//    File pengiriman sering hanya mengisi kolom QTY pada baris pertama sebuah
//    blok (satu sel QTY di-merge untuk beberapa baris / beberapa resi), baris
//    lanjutannya kosong. Kode lama mengubah setiap baris tanpa QTY menjadi 1
//    sehingga total = QTY eksplisit + jumlah baris kosong (23 + 22 = 45).
//    Aturan baru:
//      - QTY berisi angka > 0            -> dipakai apa adanya (otoritatif),
//      - QTY kosong + ada BARCODE        -> 1 unit (satu fisik barang),
//      - QTY kosong + tanpa BARCODE      -> 0, baris hanya membawa RESI/KETERANGAN,
//      - satu grup tidak punya QTY sama sekali -> qty = jumlah baris (perilaku lama,
//        ditandai `qtyFromRowCount` supaya bisa diperingatkan ke pengguna).
// 2. Tanggal bergeser 1 hari di zona WIB/UTC+7 (Excel mengembalikan tengah malam
//    waktu lokal, kode lama memakai toISOString() yang mengonversi ke UTC).
// 3. Tanggal teks seperti "14-Oct-26" / "14/10/2026" dulu jatuh ke tanggal hari ini.
// 4. Deteksi duplikat: baris tanpa BARCODE (mis. baris resi) dulu tidak pernah
//    dianggap duplikat sehingga upload ulang file yang sama menggandakan qty.
// =============================================================================
import * as XLSX from "xlsx";

export const SHIPPING_HEADERS = [
  "In Progress Date",
  "NO TICKET",
  "CABANG/GERAI",
  "KODE GERAI",
  "NAMA BARANG",
  "QTY",
  "KETERANGAN",
  "RESI",
  "BARCODE",
  "TYPE BARANG",
  "STATUS REQUEST",
  "STATUS ASSET",
  "STATUS TERKIRIM",
] as const;

/** Lokasi stok kanonis per kondisi aset. */
export type KodeKondisi = "STOK-BARU" | "STOK-RETUR" | "STOK-UNREADY";

export interface ParsedShippingRow {
  /** Nomor baris asli di Excel (1-based) — dipakai untuk pesan peringatan. */
  rowNo: number;
  date: string;
  /** false bila kolom In Progress Date kosong (dipakai tanggal hari ini). */
  dateExplicit: boolean;
  ticket: string;
  branch: string;
  branchCode: string;
  itemName: string;
  /** Qty efektif baris ini (0 = baris lanjutan yang hanya membawa resi/keterangan). */
  qty: number;
  /** true bila kolom QTY memang diisi angka > 0 di file. */
  qtyExplicit: boolean;
  /** true bila kolom QTY diisi tapi tidak terbaca sebagai angka. */
  qtyUnreadable: boolean;
  hasBarcode: boolean;
  ket: string;
  resi: string;
  barcode: string;
  typeBarang: string;
  statusRequest: string;
  statusAset: string;
  terkirim: string;
}

export interface AggLine {
  /** Kunci barang yang dipakai pengelompokan (nama barang atau id barang). */
  itemKey: string;
  itemName: string;
  kodeKondisi: KodeKondisi;
  isPending: boolean;
  /** Jumlah unit final yang dipakai sistem. */
  qty: number;
  /** Sumber angka qty — ditampilkan di pratinjau supaya bisa dicek. */
  qtySource: "qty-kolom" | "barcode" | "jumlah-baris" | "alokasi";
  /** Bagian angka QTY file yang jatuh ke baris-baris ini (0 bila kolom QTY kosong). */
  qtyFile: number;
  /** Jumlah barcode/unit unik pada baris-baris ini (tiap barcode = 1 unit). */
  qtyBarcode: number;
  /** Jumlah baris data pada blok ini. */
  rowCount: number;
  /** Jumlah baris tanpa QTY & tanpa BARCODE (baris lanjutan blok ber-QTY). */
  blankQtyRows: number;
  rows: ParsedShippingRow[];
}

export interface ParsedSheet {
  headerIndex: number;
  rows: ParsedShippingRow[];
}

// ---------------------------------------------------------------- util dasar

/** Pecah sel yang menyimpan beberapa nilai per baris (hasil agregasi upload). */
const splitText = (v: string | null | undefined): string[] =>
  (v ?? "").split("\n").map((s) => s.trim()).filter(Boolean);

export const toText = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  return String(v).trim();
};

/** Kode/nomor (resi, barcode, kode gerai) — angka besar tidak boleh jadi notasi ilmiah. */
export const toCode = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") return Number.isInteger(v) ? v.toFixed(0) : String(v);
  return String(v).trim();
};

const pad2 = (n: number): string => String(n).padStart(2, "0");
const round3 = (n: number): number => Math.round(n * 1000) / 1000;
export const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, agu: 8, aug: 8,
  sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, des: 12,
};

const isoOf = (y: number, m: number, d: number): string | null => {
  if (!(y > 1900 && y < 2200) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
};

const fullYear = (y: number): number => (y < 100 ? 2000 + y : y);

/** "14-Oct-26", "14/10/2026", "2026-10-14", "20261014" -> "YYYY-MM-DD". */
export function parseDateText(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return isoOf(Number(m[1]), Number(m[2]), Number(m[3]));
  m = t.match(/^(\d{8})$/);
  if (m) return isoOf(Number(t.slice(0, 4)), Number(t.slice(4, 6)), Number(t.slice(6, 8)));
  m = t.match(/^(\d{1,2})[-/.\s]+([A-Za-z]{3,})[-/.\s]+(\d{2,4})/);
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo) return isoOf(fullYear(Number(m[3])), mo, Number(m[1]));
  }
  m = t.match(/^([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo) return isoOf(Number(m[3]), mo, Number(m[2]));
  }
  // Format Indonesia dd/mm/yyyy (hari dulu).
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) return isoOf(fullYear(Number(m[3])), Number(m[2]), Number(m[1]));
  return null;
}

/**
 * Tanggal dari sel Excel. PENTING: jangan pakai toISOString() — untuk pengguna
 * WIB (UTC+7) tanggal 14-10 lokal jadi 13-10 UTC sehingga request_date bergeser.
 */
/** Sama seperti parseSheetDate, tetapi null bila sel tanggalnya kosong/tidak valid. */
export function parseSheetDateOrNull(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return isoOf(v.getFullYear(), v.getMonth() + 1, v.getDate());
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return isoOf(d.y, d.m, d.d);
  }
  return parseDateText(toText(v));
}

export function parseSheetDate(v: unknown, fallback: string = todayIso()): string {
  return parseSheetDateOrNull(v) ?? fallback;
}

/** Angka dari sel: 23 / "23" / "23 unit" / "1.234" (ribuan) / "23,5". */
export function parseNumberLike(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.replace(/[\s\u00a0]/g, "");
  if (!s) return null;
  // "1.234" (pemisah ribuan gaya Indonesia) harus dicek sebelum desimal.
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ""));
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^-?\d+(,\d+)?$/.test(s)) return Number(s.replace(",", "."));
  const m = s.match(/^-?\d+(?:[.,]\d+)?/);
  return m ? Number(m[0].replace(",", ".")) : null;
}

/**
 * Qty satu baris.
 * - angka > 0        -> dipakai (otoritatif)
 * - kosong + barcode -> 1
 * - kosong tanpa barcode -> 0 (baris lanjutan: hanya resi/keterangan)
 */
export function parseQtyCell(v: unknown, hasBarcode: boolean): { qty: number; explicit: boolean; unreadable: boolean } {
  const num = parseNumberLike(v);
  if (num !== null && num > 0) return { qty: round3(num), explicit: true, unreadable: false };
  // Angka 0 atau sel kosong diperlakukan sama: baris lanjutan (0) atau
  // 1 unit bila baris itu membawa BARCODE sendiri.
  if (num !== null) return { qty: hasBarcode ? 1 : 0, explicit: false, unreadable: false };
  const raw = toText(v);
  if (!raw) return { qty: hasBarcode ? 1 : 0, explicit: false, unreadable: false };
  return { qty: hasBarcode ? 1 : 0, explicit: false, unreadable: true };
}

// ---------------------------------------------------------------- baca sheet

export function findHeaderRow(aoa: unknown[][]): number {
  const idx = aoa.findIndex((r) => Array.isArray(r) && r.some((c) => toText(c).toUpperCase() === "NAMA BARANG"));
  return idx >= 0 ? idx : 0;
}

/** Apakah sheet ini berisi tabel dokumen pengiriman (punya kolom NAMA BARANG)? */
export function hasShippingHeader(aoa: unknown[][]): boolean {
  return aoa.some((r) => Array.isArray(r) && r.some((c) => toText(c).toUpperCase() === "NAMA BARANG"));
}

export interface SheetCandidate {
  name: string;
  rows: ParsedShippingRow[];
}

export interface WorkbookParse {
  /** Sheet yang berisi tabel pengiriman + minimal 1 baris data. */
  sheets: SheetCandidate[];
  /** Sheet lain (kosong / bukan tabel pengiriman). */
  skipped: { name: string; reason: string }[];
}

/**
 * Baca semua sheet di workbook dan kembalikan yang berisi data pengiriman.
 * Penting untuk file gabungan (mis. "DOKUMEN PENGIRIMAN 2026" yang punya satu
 * sheet per tanggal): sheet pertama belum tentu berisi data yang mau di-upload.
 */
export function parseWorkbook(wb: {
  SheetNames: string[];
  Sheets: Record<string, unknown>;
}): WorkbookParse {
  const sheets: SheetCandidate[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets?.[name];
    if (!ws) {
      skipped.push({ name, reason: "sheet kosong" });
      continue;
    }
    let aoa: unknown[][];
    try {
      aoa = XLSX.utils.sheet_to_json<unknown[]>(ws as XLSX.WorkSheet, { header: 1, defval: "" });
    } catch {
      skipped.push({ name, reason: "gagal dibaca" });
      continue;
    }
    if (aoa.length < 2 || !hasShippingHeader(aoa)) {
      skipped.push({ name, reason: "bukan tabel pengiriman" });
      continue;
    }
    const rows = parseShippingSheet(aoa).rows;
    if (rows.length === 0) {
      skipped.push({ name, reason: "tidak ada baris data" });
      continue;
    }
    sheets.push({ name, rows });
  }
  return { sheets, skipped };
}

export function parseShippingSheet(aoa: unknown[][]): ParsedSheet {
  const headerIndex = findHeaderRow(aoa);
  const headers = (aoa[headerIndex] ?? []).map((c) => toText(c).toUpperCase());
  const col = (...names: string[]): number => {
    for (const n of names) {
      const i = headers.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const cDate = col("IN PROGRESS DATE", "TANGGAL");
  const cTicket = col("NO TICKET");
  const cBranch = col("CABANG/GERAI", "GERAI");
  const cBranchCode = col("KODE GERAI");
  const cItem = col("NAMA BARANG");
  const cQty = col("QTY");
  const cKet = col("KETERANGAN");
  const cResi = col("RESI");
  const cBarcode = col("BARCODE");
  const cType = col("TYPE BARANG");
  const cStatusReq = col("STATUS REQUEST");
  const cStatusAset = col("STATUS ASSET");
  const cTerkirim = col("STATUS TERKIRIM");

  if (cItem < 0) {
    throw new Error("Kolom NAMA BARANG tidak ditemukan. Pakai template yang disediakan.");
  }

  const cell = (r: unknown[], c: number): unknown => (c >= 0 ? r[c] : "");
  const rows: ParsedShippingRow[] = [];
  for (let i = headerIndex + 1; i < aoa.length; i++) {
    const r = aoa[i];
    if (!Array.isArray(r)) continue;
    const itemName = toText(cell(r, cItem));
    if (!itemName || itemName.toUpperCase() === "NAMA BARANG") continue;
    const barcode = toCode(cell(r, cBarcode));
    const qtyParsed = parseQtyCell(cell(r, cQty), Boolean(barcode));
    const tanggal = cDate >= 0 ? parseSheetDateOrNull(cell(r, cDate)) : null;
    rows.push({
      rowNo: i + 1,
      date: tanggal ?? todayIso(),
      dateExplicit: tanggal !== null,
      ticket: toText(cell(r, cTicket)),
      branch: toText(cell(r, cBranch)) || "TANPA GERAI",
      branchCode: toCode(cell(r, cBranchCode)),
      itemName,
      qty: qtyParsed.qty,
      qtyExplicit: qtyParsed.explicit,
      qtyUnreadable: qtyParsed.unreadable,
      hasBarcode: Boolean(barcode),
      ket: toText(cell(r, cKet)),
      resi: toCode(cell(r, cResi)),
      barcode,
      typeBarang: toText(cell(r, cType)),
      statusRequest: toText(cell(r, cStatusReq)),
      statusAset: toText(cell(r, cStatusAset)),
      terkirim: toText(cell(r, cTerkirim)).toUpperCase(),
    });
  }
  return { headerIndex, rows };
}

// ---------------------------------------------------------------- agregasi

export function kondisiOf(statusAset: string | null | undefined): KodeKondisi {
  const s = toText(statusAset).toUpperCase();
  if (s.includes("RETUR") || s.includes("RETURN")) return "STOK-RETUR";
  if (s.includes("UNREADY")) return "STOK-UNREADY";
  return "STOK-BARU";
}

export const asetLabelOf = (kode: KodeKondisi): string =>
  kode === "STOK-RETUR" ? "ASSET RETUR" : kode === "STOK-UNREADY" ? "ASSET UNREADY" : "ASSET BARU";

export function groupKeyOf(row: ParsedShippingRow): string {
  return row.ticket
    ? `${row.date}|${row.branch}|${row.ticket}`
    : `${row.date}|${row.branch}|ITEM:${row.itemName.toUpperCase()}`;
}

/**
 * Gabungkan baris-baris satu permintaan (satu tiket/gerai/tanggal) menjadi baris item
 * (barang + kondisi aset + status terkirim).
 *
 * Cara file pengiriman diisi (terverifikasi pada file lapangan):
 *  - Satu blok barang = beberapa baris berurutan dengan nama barang sama.
 *  - Kolom QTY di-merge dan ditulis sekali di baris pertama blok = **total unit blok
 *    itu**, bukan qty baris tersebut (mis. QTY 23 untuk 23 baris KURSI TRAINING).
 *  - Umumnya 1 baris = 1 unit fisik (punya resi/SN sendiri), tetapi ada blok seperti
 *    "oSD Ezviz ... QTY 3" yang hanya ditulis 1 baris.
 *
 * Aturan qty: total blok = angka tertinggi antara QTY yang tertulis, jumlah
 * barcode/unit unik, dan jumlah baris; lalu dibagikan rata ke baris-baris blok
 * (tiap baris minimal 1 unit, sisanya ke baris awal). Hasil akhirnya dijumlahkan
 * per barang + kondisi aset + status terkirim.
 */
export interface RowAllocation {
  /** Unit yang dibebankan ke baris ini (hasil pembagian total blok). */
  qty: number;
  /** Bagian angka QTY file untuk baris ini (0 bila kolom QTY kosong). */
  fileShare: number;
}

/**
 * Tentukan unit per baris untuk seluruh baris satu permintaan.
 * Blok dimulai ketika nama barang berubah ATAU muncul angka QTY baru (satu angka
 * QTY hasil merge selalu memulai blok berikutnya, walau nama barangnya sama).
 */
export function allocateBlockUnits(
  rows: ParsedShippingRow[],
): Map<ParsedShippingRow, RowAllocation> {
  const blocks: ParsedShippingRow[][] = [];
  for (const r of rows) {
    const last = blocks[blocks.length - 1];
    const continues =
      Boolean(last) &&
      !r.qtyExplicit &&
      last[0].itemName.trim().toUpperCase() === r.itemName.trim().toUpperCase();
    if (continues) last.push(r);
    else blocks.push([r]);
  }

  const alloc = new Map<ParsedShippingRow, RowAllocation>();
  for (const block of blocks) {
    const explicit = round3(block.reduce((s, r) => s + (r.qtyExplicit ? r.qty : 0), 0));
    const barcodes = new Set<string>();
    for (const r of block) for (const b of splitText(r.barcode)) barcodes.add(b);
    const n = block.length;
    // Total unit blok = angka QTY yang tertulis, jumlah barcode unik, dan jumlah
    // baris (tiap baris = satu unit fisik dengan resi/SN sendiri).
    const total = round3(Math.max(explicit, barcodes.size, n));
    const base = Math.floor(total / n);
    const remainder = Math.round(total - base * n);
    block.forEach((r, i) => {
      alloc.set(r, {
        qty: round3(base + (i < remainder ? 1 : 0)),
        fileShare: explicit > 0 ? explicit / n : 0,
      });
    });
  }
  return alloc;
}

export function aggregateGroup(
  rows: ParsedShippingRow[],
  itemKeyOf: (row: ParsedShippingRow) => string,
): AggLine[] {
  const alloc = allocateBlockUnits(rows);

  // Kumpulkan per barang + kondisi aset + status terkirim.
  const byKey = new Map<string, AggLine>();
  for (const r of rows) {
    const itemKey = itemKeyOf(r);
    const kodeKondisi = kondisiOf(r.statusAset);
    const isPending = r.terkirim === "PENDING";
    const key = `${itemKey}|${kodeKondisi}|${isPending ? "PENDING" : "TERKIRIM"}`;
    let line = byKey.get(key);
    if (!line) {
      line = {
        itemKey, itemName: r.itemName, kodeKondisi, isPending,
        qty: 0, qtySource: "qty-kolom", qtyFile: 0, qtyBarcode: 0, rowCount: 0,
        blankQtyRows: 0, rows: [],
      };
      byKey.set(key, line);
    }
    line.rows.push(r);
    const a = alloc.get(r);
    if (a) {
      line.qty += a.qty;
      line.qtyFile += a.fileShare;
    }
    if (!r.qtyExplicit && !r.hasBarcode) line.blankQtyRows++;
  }

  for (const line of byKey.values()) {
    line.qty = round3(line.qty);
    line.qtyFile = round3(line.qtyFile);
    const barcodes = new Set<string>();
    for (const r of line.rows) for (const b of splitText(r.barcode)) barcodes.add(b);
    line.rowCount = line.rows.length;
    line.qtyBarcode = barcodes.size;
    if (line.qtyFile === 0) {
      line.qtySource = "jumlah-baris";
    } else if (line.qty > line.qtyFile) {
      line.qtySource = line.qtyBarcode > line.qtyFile ? "barcode" : "alokasi";
    } else {
      line.qtySource = "qty-kolom";
    }
  }
  return [...byKey.values()];
}

/** Agregasi lintas grup (dipakai untuk pratinjau sebelum import). */
export function aggregateAll(
  rows: ParsedShippingRow[],
  itemKeyOf: (row: ParsedShippingRow) => string = (r) => r.itemName.toUpperCase(),
): AggLine[] {
  return aggregateGroup(rows, itemKeyOf);
}

// ---------------------------------------------------------------- duplikat

export interface StoredItemRow {
  ticket_no: string;
  request_date: string;
  item_id: string;
  barcode: string | null;
  resi: string | null;
  qty_requested: number | string;
}

export interface DupIndex {
  counts: Map<string, number>;
}

const dupKey = (ticket: string, date: string, itemKey: string, tag: string): string =>
  `${ticket.toUpperCase()}|${date}|${itemKey}|${tag}`;

const ANON = "ANON";

/**
 * Kumpulkan "sidik jari" baris yang sudah pernah diimpor:
 * - BARCODE / RESI  -> 1 slot per nilai (baris lama bisa menyimpan banyak nilai
 *   yang dipisah baris baru karena hasil agregasi),
 * - tanpa keduanya  -> slot qty (baris anonim dibandingkan berdasarkan total qty).
 */
export function buildDupIndex(stored: StoredItemRow[]): DupIndex {
  const counts = new Map<string, number>();
  const add = (key: string, amount: number) => counts.set(key, (counts.get(key) ?? 0) + amount);
  for (const s of stored) {
    const barcodes = splitText(s.barcode);
    const resis = splitText(s.resi);
    if (barcodes.length === 0 && resis.length === 0) {
      const qty = parseNumberLike(s.qty_requested) ?? 1;
      add(dupKey(s.ticket_no, s.request_date, s.item_id, ANON), qty > 0 ? qty : 1);
      continue;
    }
    for (const b of barcodes) add(dupKey(s.ticket_no, s.request_date, s.item_id, `BC:${b}`), 1);
    for (const r of resis) add(dupKey(s.ticket_no, s.request_date, s.item_id, `RS:${r}`), 1);
  }
  return { counts };
}

export interface DupFilterResult {
  kept: ParsedShippingRow[];
  skipped: ParsedShippingRow[];
}

/** Buang baris yang identitasnya (tiket + barang + barcode/resi) sudah ada di sistem. */
export function filterDuplicateRows(
  rows: ParsedShippingRow[],
  itemKeyOf: (row: ParsedShippingRow) => string,
  index: DupIndex,
): DupFilterResult {
  const used = new Map<string, number>();
  const take = (key: string, amount: number): boolean => {
    const have = index.counts.get(key) ?? 0;
    const taken = used.get(key) ?? 0;
    if (have - taken < amount) return false;
    used.set(key, taken + amount);
    return true;
  };
  const kept: ParsedShippingRow[] = [];
  const skipped: ParsedShippingRow[] = [];
  for (const r of rows) {
    const itemKey = itemKeyOf(r);
    if (!r.ticket || !itemKey) {
      kept.push(r);
      continue;
    }
    const barcodes = splitText(r.barcode);
    const resis = splitText(r.resi);
    let duplicate = false;
    if (barcodes.length === 0 && resis.length === 0) {
      duplicate = take(dupKey(r.ticket, r.date, itemKey, ANON), r.qty > 0 ? r.qty : 1);
    } else {
      for (const b of barcodes) {
        if (take(dupKey(r.ticket, r.date, itemKey, `BC:${b}`), 1)) { duplicate = true; break; }
      }
      if (!duplicate) {
        for (const s of resis) {
          if (take(dupKey(r.ticket, r.date, itemKey, `RS:${s}`), 1)) { duplicate = true; break; }
        }
      }
    }
    (duplicate ? skipped : kept).push(r);
  }
  return { kept, skipped };
}

/** Baris dengan tiket + barang + barcode/resi sama di dalam satu file (indikasi dobel isi). */
export function findDuplicateRowsInFile(
  rows: ParsedShippingRow[],
  itemKeyOf: (row: ParsedShippingRow) => string,
): ParsedShippingRow[] {
  const seen = new Set<string>();
  const dups: ParsedShippingRow[] = [];
  for (const r of rows) {
    const itemKey = itemKeyOf(r);
    const id = r.barcode || r.resi;
    if (!r.ticket || !itemKey || !id) continue;
    const key = `${r.ticket.toUpperCase()}|${r.date}|${itemKey}|${id}`;
    if (seen.has(key)) dups.push(r);
    else seen.add(key);
  }
  return dups;
}
