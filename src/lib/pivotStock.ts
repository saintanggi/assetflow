import * as XLSX from "xlsx";

/**
 * Laporan Stok Pivot — modelnya file Laporan_Stok_Pivot_2026-11-01_sd_2026-11-11.xlsx
 * dari Anggi: baris = barang, kolom = tanggal (pivot ke samping), isi = stok akhir
 * per tanggal. Sheet dipisah per jenis stok (Barang Baru / Return / Unready),
 * sama seperti export Excel Live Stok.
 *
 * Pemetaan kolom dari file contoh:
 *   NO -> NO | MATERIAL -> SKU | ITEM -> Item | SATUAN -> Satuan (kode unit)
 *   BUFFER -> Stok Minimum (min_stock) | STATUS -> pisah sheet per jenis stok
 *   kolom tanggal -> stok akhir (end-of-day) per tanggal.
 */

export interface PivotBalance {
  item_id: string;
  location_id: string;
  qty: number;
  /** Saldo awal (snapshot SO) — dipakai untuk cek rekonsiliasi riwayat. */
  opening: number;
}

export interface PivotMove {
  item_id: string;
  location_id: string;
  qty_change: number;
  /** Tanggal transaksi (tanggal pengiriman / tanggal bisnis), 'YYYY-MM-DD'. */
  txnDate: string;
}

export interface PivotItemInfo {
  sku: string;
  name: string;
  /** Kode satuan, mis. PCS / PACK / DUS. */
  unit: string;
  /** Stok Minimum (Buffer). */
  buffer: number;
  locCode: string;
  locName: string;
}

export interface PivotRow {
  sku: string;
  item: string;
  unit: string;
  buffer: number;
  location: string;
  locCode: string;
  /** Stok akhir per tanggal, sejajar dengan `dates`. */
  daily: number[];
  /**
   * True bila saldo awal + seluruh mutasi ledger = saldo kini. False bila
   * riwayatnya pernah diedit tanpa jejak ledger (mis. Atur Stok) — tanggal
   * awal baris itu bersifat perkiraan, kolom tanggal terakhir tetap akurat.
   */
  reconciled: boolean;
}

/** Daftar tanggal 'YYYY-MM-DD' dari `start` s/d `end` (inklusif). */
export function eachDay(start: string, end: string): string[] {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const out: string[] = [];
  const cur = new Date(Date.UTC(sy, sm - 1, sd));
  const last = new Date(Date.UTC(ey, em - 1, ed));
  while (cur <= last) {
    const y = cur.getUTCFullYear();
    const m = String(cur.getUTCMonth() + 1).padStart(2, "0");
    const d = String(cur.getUTCDate()).padStart(2, "0");
    out.push(`${y}-${m}-${d}`);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export type StockKind = "baru" | "retur" | "unready";

/** Jenis stok dari AKHIRAN kode lokasi (STOK-BARU, CEMPAKA_PUTIH-BARU, dst.). */
export function kindOf(locCode: string): StockKind {
  if (locCode.endsWith("-BARU")) return "baru";
  if (locCode.endsWith("-RETUR")) return "retur";
  return "unready";
}

export function splitPivotRows(rows: PivotRow[]): {
  baru: PivotRow[];
  retur: PivotRow[];
  unready: PivotRow[];
} {
  return {
    baru: rows.filter((r) => kindOf(r.locCode) === "baru"),
    retur: rows.filter((r) => kindOf(r.locCode) === "retur"),
    unready: rows.filter((r) => kindOf(r.locCode) === "unready"),
  };
}

/**
 * Stok akhir per tanggal.
 * end(D) = saldo saat ini − jumlah mutasi dengan tanggal transaksi > D.
 * Mutasi bertanggal <= D sudah tercermin di saldo akhir hari itu; mutasi
 * bertanggal sebelum periode tidak mengurangi tanggal mana pun; mutasi
 * bertanggal setelah periode tidak masuk ke tanggal mana pun di periode.
 */
export function buildPivotSeries(
  balances: PivotBalance[],
  moves: PivotMove[],
  dates: string[],
  info: Map<string, PivotItemInfo>, // key: item_id|location_id
): PivotRow[] {
  const byKey = new Map<string, PivotMove[]>();
  for (const m of moves) {
    const k = `${m.item_id}|${m.location_id}`;
    const arr = byKey.get(k) ?? [];
    arr.push(m);
    byKey.set(k, arr);
  }
  const balMap = new Map(
    balances.map((b) => [`${b.item_id}|${b.location_id}`, b.qty]),
  );
  const openMap = new Map(
    balances.map((b) => [`${b.item_id}|${b.location_id}`, b.opening]),
  );
  const keys = new Set([...balMap.keys(), ...byKey.keys()]);
  const rows: PivotRow[] = [];
  for (const key of keys) {
    const meta = info.get(key);
    if (!meta) continue;
    const cur = balMap.get(key) ?? 0;
    const arr = byKey.get(key) ?? [];
    const daily = dates.map((d) => {
      let after = 0;
      for (const mv of arr) if (mv.txnDate > d) after += mv.qty_change;
      return cur - after;
    });
    // Lewati baris yang nol di semua tanggal (sama seperti Live Stok).
    if (daily.every((v) => v === 0)) continue;
    // Rekonsiliasi: saldo awal + seluruh mutasi harus sama dengan saldo kini.
    const totalMoves = arr.reduce((a, mv) => a + mv.qty_change, 0);
    const reconciled =
      Math.abs((openMap.get(key) ?? 0) + totalMoves - cur) < 0.001;
    rows.push({
      sku: meta.sku,
      item: meta.name,
      unit: meta.unit,
      buffer: meta.buffer,
      location: meta.locName,
      locCode: meta.locCode,
      daily,
      reconciled,
    });
  }
  rows.sort((a, b) => a.item.localeCompare(b.item, "id"));
  return rows;
}

/** Batas rentang pivot (hari) supaya file tidak melebar tanpa batas. */
export const PIVOT_MAX_DAYS = 92;

export function buildPivotWorkbook(opts: {
  rows: PivotRow[];
  dates: string[];
  whName: string;
  startDate: string;
  endDate: string;
}): XLSX.WorkBook {
  const { rows, dates, whName, startDate, endDate } = opts;
  const { baru, retur, unready } = splitPivotRows(rows);
  const wb = XLSX.utils.book_new();

  // --- Sheet Ringkasan ---
  const lastIdx = dates.length - 1;
  const sumLast = (rs: PivotRow[]) =>
    rs.reduce((a, r) => a + (r.daily[lastIdx] ?? 0), 0);
  const ringkasan: (string | number)[][] = [
    ["Laporan Stok Pivot"],
    [`Gudang: ${whName}`],
    [`Periode: ${startDate} s/d ${endDate}`],
    [`Diunduh: ${new Date().toLocaleString("id-ID")}`],
    [],
    ["Kategori", "Jumlah Item", `Stok Akhir ${dates[lastIdx] ?? "-"}`],
    ["Barang Baru", baru.length, sumLast(baru)],
    ["Return", retur.length, sumLast(retur)],
  ];
  if (unready.length > 0)
    ringkasan.push(["Unready", unready.length, sumLast(unready)]);
  ringkasan.push(["TOTAL", rows.length, sumLast(rows)]);
  // Catatan rekonsiliasi: baris yang riwayatnya tidak nyambung (saldo awal +
  // mutasi ≠ saldo kini) — biasanya karena ada edit Atur Stok tanpa jejak.
  // Tanggal awal baris itu bersifat perkiraan; kolom tanggal akhir tetap akurat.
  const flagged = rows.filter((r) => !r.reconciled);
  if (flagged.length > 0) {
    ringkasan.push([]);
    ringkasan.push([
      "Catatan: baris berikut riwayatnya tidak rekonsiliasi (saldo awal + mutasi ≠ saldo kini), kemungkinan ada edit Atur Stok tanpa jejak — angka tanggal awal bersifat perkiraan, angka tanggal akhir tetap akurat:",
    ]);
    for (const r of flagged)
      ringkasan.push([`${r.sku} — ${r.item} (${r.location})`]);
  }
  const wsRingkasan = XLSX.utils.aoa_to_sheet(ringkasan);
  wsRingkasan["!cols"] = [{ wch: 16 }, { wch: 12 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, wsRingkasan, "Ringkasan");

  // --- Satu sheet per jenis stok ---
  const addDetailSheet = (name: string, rs: PivotRow[]) => {
    const header = ["NO", "SKU", "Item", "Satuan", "BUFFER", "Lokasi", ...dates];
    const aoa: (string | number)[][] = [header];
    rs.forEach((r, i) => {
      aoa.push([i + 1, r.sku, r.item, r.unit, r.buffer, r.location, ...r.daily]);
    });
    const totals = dates.map((_, di) =>
      rs.reduce((a, r) => a + (r.daily[di] ?? 0), 0),
    );
    aoa.push(["", "", "TOTAL", "", "", "", ...totals]);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [
      { wch: 6 }, // NO
      { wch: 14 }, // SKU
      { wch: 42 }, // Item
      { wch: 10 }, // Satuan
      { wch: 10 }, // BUFFER
      { wch: 22 }, // Lokasi
      ...dates.map(() => ({ wch: 12 })), // tanggal
    ];
    XLSX.utils.book_append_sheet(wb, ws, name);
  };
  addDetailSheet("Barang Baru", baru);
  addDetailSheet("Return", retur);
  if (unready.length > 0) addDetailSheet("Unready", unready);
  return wb;
}
