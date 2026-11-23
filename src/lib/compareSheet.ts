// Perbandingan file upload pengiriman dengan Google Sheet (dokumen pengiriman).
// Dipakai halaman Upload Dokumen: setelah file diurai, baris-baris file
// dibandingkan dengan baris-baris Google Sheet untuk tanggal yang sama, lalu
// selisihnya ditampilkan sebagai pengingat (BUKAN penghalang — upload tetap
// bisa lanjut walau ada beda, sesuai permintaan Anggi 23 Nov 2026).
//
// File ini TIDAK termasuk salinan parser Edge Function (bukan bagian dari
// shippingUpload.ts), jadi tidak ikut aturan __sheetSyncSame.test.ts.

import {
  aggregateGroup,
  groupKeyOf,
  normalizeItemName,
  type KodeKondisi,
  type ParsedShippingRow,
} from "./shippingUpload";

/** Satu baris hasil agregasi (tiket + barang + kondisi) untuk perbandingan. */
export interface CompareLine {
  ticket: string;
  date: string;
  branch: string;
  itemName: string;
  kondisi: KodeKondisi;
  qty: number;
  /** Barcode unik (tanpa placeholder "SUDAH"), terurut. */
  barcodes: string[];
  /** Qty yang statusnya PENDING (belum terkirim). */
  pendingQty: number;
}

export interface SheetDiffLine {
  ticket: string;
  date: string;
  branch: string;
  itemName: string;
  kondisi: KodeKondisi;
  qty: number;
  barcodes: string[];
}

export interface SheetQtyDiff {
  ticket: string;
  date: string;
  itemName: string;
  kondisi: KodeKondisi;
  qtyFile: number;
  qtySheet: number;
}

export interface SheetBarcodeDiff {
  ticket: string;
  date: string;
  itemName: string;
  kondisi: KodeKondisi;
  /** Barcode yang hanya ada di file upload. */
  onlyFile: string[];
  /** Barcode yang hanya ada di Google Sheet. */
  onlySheet: string[];
}

export interface SheetStatusDiff {
  ticket: string;
  date: string;
  itemName: string;
  kondisi: KodeKondisi;
  /** Qty PENDING di file vs di Sheet (total qty sama, statusnya beda). */
  pendingFile: number;
  pendingSheet: number;
}

export interface SheetDiff {
  /** (tiket, barang, kondisi) ada di file tapi tidak ada di Sheet. */
  fileOnly: SheetDiffLine[];
  /** (tiket, barang, kondisi) ada di Sheet tapi tidak ada di file. */
  sheetOnly: SheetDiffLine[];
  /** Kunci sama, qty beda. */
  qtyMismatch: SheetQtyDiff[];
  /** Kunci sama, qty sama, tapi barcode beda. */
  barcodeMismatch: SheetBarcodeDiff[];
  /** Kunci sama, qty sama, tapi pembagian PENDING vs TERKIRIM beda. */
  statusMismatch: SheetStatusDiff[];
  fileLines: number;
  sheetLines: number;
  matchedLines: number;
  totalQtyFile: number;
  totalQtySheet: number;
}

/** Pecah isi sel barcode (satu baris bisa berisi beberapa barcode). */
function splitBarcodes(v: string | null | undefined): string[] {
  return (v ?? "")
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter((s) => s !== "" && s.toUpperCase() !== "SUDAH");
}

/**
 * Agregasi baris-baris (file atau Sheet) menjadi baris per
 * (tiket + barang + kondisi), memakai aturan blok yang sama dengan upload
 * (QTY merge = total blok, barcode = 1 unit) supaya kedua sisi sebanding.
 */
export function aggregateForCompare(rows: ParsedShippingRow[]): Map<string, CompareLine> {
  const byGroup = new Map<string, ParsedShippingRow[]>();
  for (const r of rows) {
    const k = groupKeyOf(r);
    const list = byGroup.get(k);
    if (list) list.push(r);
    else byGroup.set(k, [r]);
  }
  const out = new Map<string, CompareLine>();
  const keyOf = (r: ParsedShippingRow): string => normalizeItemName(r.itemName);
  for (const rs of byGroup.values()) {
    const first = rs[0];
    const ticket = first.ticket;
    const date = first.date;
    const branch = first.branch;
    for (const line of aggregateGroup(rs, keyOf)) {
      const key = `${ticket}|${normalizeItemName(line.itemName)}|${line.kodeKondisi}`;
      const barcodes = new Set<string>();
      for (const r of line.rows) for (const b of splitBarcodes(r.barcode)) barcodes.add(b);
      const existing = out.get(key);
      if (existing) {
        existing.qty += line.qty;
        existing.pendingQty += line.isPending ? line.qty : 0;
        for (const b of barcodes) {
          if (!existing.barcodes.includes(b)) existing.barcodes.push(b);
        }
      } else {
        out.set(key, {
          ticket,
          date,
          branch,
          itemName: line.itemName,
          kondisi: line.kodeKondisi,
          qty: line.qty,
          barcodes: [...barcodes],
          pendingQty: line.isPending ? line.qty : 0,
        });
      }
    }
  }
  for (const line of out.values()) line.barcodes.sort();
  return out;
}

function toDiffLine(l: CompareLine): SheetDiffLine {
  return {
    ticket: l.ticket,
    date: l.date,
    branch: l.branch,
    itemName: l.itemName,
    kondisi: l.kondisi,
    qty: l.qty,
    barcodes: l.barcodes,
  };
}

/**
 * Bandingkan baris file upload dengan baris Google Sheet (tanggal yang sama).
 * Kunci banding: (tiket, nama barang ternormalisasi, kondisi aset).
 * Baris tanpa tiket (tiket kosong) ikut dibanding lewat kunci grupnya.
 */
export function compareUploadWithSheet(
  fileRows: ParsedShippingRow[],
  sheetRows: ParsedShippingRow[],
): SheetDiff {
  const fileMap = aggregateForCompare(fileRows);
  const sheetMap = aggregateForCompare(sheetRows);
  const fileOnly: SheetDiffLine[] = [];
  const sheetOnly: SheetDiffLine[] = [];
  const qtyMismatch: SheetQtyDiff[] = [];
  const barcodeMismatch: SheetBarcodeDiff[] = [];
  const statusMismatch: SheetStatusDiff[] = [];
  let matchedLines = 0;
  let totalQtyFile = 0;
  let totalQtySheet = 0;
  for (const l of fileMap.values()) totalQtyFile += l.qty;
  for (const l of sheetMap.values()) totalQtySheet += l.qty;

  const keys = new Set([...fileMap.keys(), ...sheetMap.keys()]);
  for (const key of keys) {
    const f = fileMap.get(key);
    const s = sheetMap.get(key);
    if (f && !s) {
      fileOnly.push(toDiffLine(f));
      continue;
    }
    if (s && !f) {
      sheetOnly.push(toDiffLine(s));
      continue;
    }
    // Ada di kedua sisi.
    matchedLines++;
    const ff = f as CompareLine;
    const ss = s as CompareLine;
    if (ff.qty !== ss.qty) {
      qtyMismatch.push({
        ticket: ff.ticket,
        date: ff.date,
        itemName: ff.itemName,
        kondisi: ff.kondisi,
        qtyFile: ff.qty,
        qtySheet: ss.qty,
      });
      continue;
    }
    if (ff.pendingQty !== ss.pendingQty) {
      statusMismatch.push({
        ticket: ff.ticket,
        date: ff.date,
        itemName: ff.itemName,
        kondisi: ff.kondisi,
        pendingFile: ff.pendingQty,
        pendingSheet: ss.pendingQty,
      });
    }
    if (ff.barcodes.length > 0 && ss.barcodes.length > 0) {
      const setF = new Set(ff.barcodes);
      const setS = new Set(ss.barcodes);
      const onlyFile = ff.barcodes.filter((b) => !setS.has(b));
      const onlySheet = ss.barcodes.filter((b) => !setF.has(b));
      if (onlyFile.length > 0 || onlySheet.length > 0) {
        barcodeMismatch.push({
          ticket: ff.ticket,
          date: ff.date,
          itemName: ff.itemName,
          kondisi: ff.kondisi,
          onlyFile,
          onlySheet,
        });
      }
    }
  }

  const sortLines = (a: SheetDiffLine, b: SheetDiffLine): number =>
    a.ticket.localeCompare(b.ticket) || a.itemName.localeCompare(b.itemName);
  fileOnly.sort(sortLines);
  sheetOnly.sort(sortLines);
  qtyMismatch.sort((a, b) => a.ticket.localeCompare(b.ticket) || a.itemName.localeCompare(b.itemName));
  barcodeMismatch.sort((a, b) => a.ticket.localeCompare(b.ticket) || a.itemName.localeCompare(b.itemName));
  statusMismatch.sort((a, b) => a.ticket.localeCompare(b.ticket) || a.itemName.localeCompare(b.itemName));

  return {
    fileOnly,
    sheetOnly,
    qtyMismatch,
    barcodeMismatch,
    statusMismatch,
    fileLines: fileMap.size,
    sheetLines: sheetMap.size,
    matchedLines,
    totalQtyFile,
    totalQtySheet,
  };
}

/** Jumlah total selisih (semua kategori). */
export function sheetDiffCount(d: SheetDiff): number {
  return (
    d.fileOnly.length +
    d.sheetOnly.length +
    d.qtyMismatch.length +
    d.barcodeMismatch.length +
    d.statusMismatch.length
  );
}
