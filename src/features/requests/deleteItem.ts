import {
  REQUEST_STATUS_LABELS,
  type RequestStatus,
} from "../../types/database";

/** Ringkasan baris yang akan dihapus — dipakai untuk membangun teks konfirmasi. */
export interface DeleteItemSummary {
  /** Nama barang (inventory_items.name). */
  name: string;
  /** Jumlah terkirim pada baris ini (0 = belum pernah kirim). */
  qtyShipped: number;
  /** Kode lokasi tujuan pengembalian stok (mis. STOK-BARU). */
  locationCode: string;
}

function formatQty(n: number): string {
  return n.toLocaleString("id-ID", { maximumFractionDigits: 3 });
}

/**
 * Teks `window.confirm` untuk tombol Hapus Item di dialog Edit.
 * Perilaku baris terakhir dicegah di sisi klien maupun di RPC, jadi di sini
 * cukup membedakan dampak stok: qty_shipped = 0 tanpa efek stok, selain itu
 * menyebut pengembalian eksplisit (transaksi IN koreksi di Log Transaksi).
 */
export function describeItemDelete(s: DeleteItemSummary): string {
  const qty = Number(s.qtyShipped);
  if (!(qty > 0)) {
    return [
      `Hapus baris "${s.name}" dari daftar Item Permintaan?`,
      "",
      "Baris ini belum ada yang terkirim, jadi tidak ada dampak ke stok. ",
      "Baris akan dihapus permanen dan tidak dapat dibatalkan.",
    ].join("\n");
  }
  return [
    `Hapus baris "${s.name}" dari daftar Item Permintaan?`,
    "",
    `Baris ini tercatat sudah terkirim ${formatQty(qty)} unit. Sistem akan ` +
      `mengembalikan ${formatQty(qty)} unit stok ke ${s.locationCode} sebagai ` +
      "transaksi koreksi IN (tercatat di Log Transaksi), lalu menghapus baris. ",
    "Riwayat pengiriman OUT lama tetap tersimpan. Tindakan tidak dapat dibatalkan.",
  ].join("\n");
}

/** Bentuk hasil RPC `admin_delete_request_item` (jsonb). */
export interface DeleteItemResult {
  ok?: boolean;
  qty_restored?: number | string | null;
  in_doc?: string | null;
  status?: string | null;
}

/** Pesan sukses toast setelah RPC `admin_delete_request_item` berhasil. */
export function formatDeleteItemResult(
  result: unknown,
  name: string,
): string {
  const r = (result ?? {}) as DeleteItemResult;
  const qty = Number(r.qty_restored ?? 0);
  const parts: string[] = [`Baris "${name}" dihapus dari permintaan.`];
  if (qty > 0) {
    const doc = r.in_doc ? ` (dokumen ${r.in_doc})` : "";
    parts.push(`Stok ${formatQty(qty)} unit dikembalikan${doc}.`);
  }
  if (r.status && r.status in REQUEST_STATUS_LABELS) {
    const label =
      REQUEST_STATUS_LABELS[r.status as RequestStatus] ?? r.status;
    parts.push(`Status tiket kini: ${label}.`);
  }
  return parts.join(" ");
}
