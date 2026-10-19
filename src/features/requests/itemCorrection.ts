/**
 * Koreksi barang / Status Aset pada baris permintaan yang SUDAH terkirim.
 *
 * Mengubah nama barang di tiket TIDAK otomatis memindahkan stok: transaksi OUT
 * yang sudah posted tetap menempel di barang lama, sehingga stoknya bisa minus
 * (contoh nyata: MONITOR SET -4 di STOK-RETUR padahal tiket sudah jadi MONITOR).
 *
 * Helper di sini menyiapkan teks konfirmasi & hasil untuk RPC
 * `admin_change_request_item` yang memindahkan stok secara atomik.
 */
import type { ExcelStatusAset } from "../../types/database";

export interface ItemChangeInput {
  oldItemId: string;
  newItemId: string;
  oldStatus: ExcelStatusAset;
  newStatus: ExcelStatusAset;
  qtyShipped: number;
}

/** true bila perubahan menyentuh barang/Status Aset pada baris yang sudah dikirim. */
export function needsStockMove(input: ItemChangeInput): boolean {
  if (!(input.qtyShipped > 0)) return false;
  return input.oldItemId !== input.newItemId || input.oldStatus !== input.newStatus;
}

export interface ItemChangeDescription extends ItemChangeInput {
  oldName: string;
  newName: string;
}

/**
 * Teks dialog konfirmasi: menjelaskan bahwa stok akan dipindahkan, bukan hanya
 * namanya di tiket yang berubah.
 */
export function describeItemChange(d: ItemChangeDescription): string {
  const qty = Number(d.qtyShipped).toLocaleString("id-ID", { maximumFractionDigits: 3 });
  const itemLine =
    d.oldItemId === d.newItemId
      ? `Barang tetap "${d.newName}", Status Aset berubah ${d.oldStatus} → ${d.newStatus}.`
      : `Barang berubah "${d.oldName}" → "${d.newName}"` +
        (d.oldStatus === d.newStatus
          ? ` (Status Aset tetap ${d.newStatus}).`
          : ` (Status Aset ${d.oldStatus} → ${d.newStatus}).`);
  return (
    `${itemLine}\n\n` +
    `Baris ini sudah dikirim ${qty} unit. Stok akan dipindahkan otomatis:\n` +
    `• ${qty} unit dikembalikan ke "${d.oldName}" di lokasi lama\n` +
    `• ${qty} unit dipotong dari "${d.newName}" di lokasi baru\n\n` +
    "Dua transaksi koreksi akan tercatat di Log Transaksi. Lanjutkan?"
  );
}

/** true bila error berarti fungsi RPC belum dipasang di database. */
export function isMissingRpcError(message: string): boolean {
  return /could not find the function|function .* does not exist|PGRST202|\b42883\b/i.test(
    message
  );
}

export interface StockMoveResult {
  moved?: boolean;
  qty?: number | string;
  from_item?: string;
  to_item?: string;
  from_location?: string;
  to_location?: string;
  in_doc?: string | null;
  out_doc?: string | null;
  note?: string;
}

/** Ringkasan hasil RPC untuk toast (aman bila sebagian field kosong). */
export function formatStockMoveResult(
  result: { stock_move?: StockMoveResult | null } | null | undefined,
  fallbackItemName = "barang"
): string {
  const move = result?.stock_move;
  if (!move) return "Data item diperbarui. Belum ada stok yang perlu dipindahkan.";
  if (!move.moved) {
    return move.note ?? "Data item diperbarui. Tidak ada stok yang dipindahkan.";
  }
  const qty = Number(move.qty ?? 0).toLocaleString("id-ID", { maximumFractionDigits: 3 });
  const asal = `${move.from_item ?? fallbackItemName} (${move.from_location ?? "lokasi lama"})`;
  const tujuan = `${move.to_item ?? fallbackItemName} (${move.to_location ?? "lokasi baru"})`;
  const docs = [move.in_doc, move.out_doc].filter(Boolean).join(" & ");
  return (
    `Data item diperbarui. Stok ${qty} unit dipindahkan dari ${asal} ke ${tujuan}` +
    (docs ? ` — dokumen koreksi ${docs}.` : ".")
  );
}
