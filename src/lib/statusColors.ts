import type {
  AssetCondition,
  AssetStatus,
  RequestStatus,
} from "../types/database";

/**
 * ATURAN WARNA STATUS — satu sumber kebenaran untuk seluruh aplikasi
 * (disepakati 5 Nov 2026, dari arahan Anggi: sekilas langsung kelihatan
 * mana yang bermasalah, mana yang menunggu, mana yang sudah beres).
 *
 * MERAH (destructive) = bermasalah, harus segera ditindak:
 *   habis, kritis, ditolak, rusak, dibatalkan.
 * KUNING (warning) = menunggu / pending / perlu perhatian:
 *   diajukan, diproses, disetujui sebagian, menunggu stok, belum terkirim,
 *   menipis, waspada, dipesan (PO ordered).
 * HIJAU (success) = beres / aman:
 *   selesai, terkirim, disetujui, siap, tersedia, aman.
 * BIRU (info) = netral / informasi:
 *   digunakan, transfer.
 * ABU (secondary) = nonaktif / arsip / belum mulai:
 *   dipensiunkan, nonaktif, draft, privat.
 *
 * Semua halaman WAJIB memakai helper di file ini — jangan bikin peta warna
 * lokal sendiri lagi (dulu ada 6+ salinan STATUS_VARIANT yang isinya
 * beda-beda: mis. "diajukan" biru di satu halaman tapi kuning di tempat lain,
 * "selesai" abu-abu padahal itu beres, dan di Stok Kondisi "KRITIS" merah
 * sementara "HABIS" malah abu-abu).
 */

export type StatusBadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "success"
  | "warning"
  | "info";

export type PoStatus =
  | "draft"
  | "ordered"
  | "received_partial"
  | "received"
  | "cancelled";

export type StockStatus = "habis" | "menipis" | "aman";

export type KondisiStatus = "AMAN" | "KRITIS" | "HABIS";

export type AlertLevel = "kritis" | "waspada";

export type PendingJenis = "Belum Terkirim" | "Menunggu Stok";

/** Status aset tetap: tersedia (beres), digunakan (dipakai), rusak (masalah). */
export const assetStatusVariant: Record<AssetStatus, StatusBadgeVariant> = {
  tersedia: "success",
  digunakan: "info",
  dipinjamkan: "warning",
  perbaikan: "warning",
  rusak: "destructive",
  dipensiunkan: "secondary",
};

/** Kondisi fisik aset: baik (beres), rusak ringan (perhatian), rusak berat (masalah). */
export const assetConditionVariant: Record<AssetCondition, StatusBadgeVariant> = {
  baik: "success",
  rusak_ringan: "warning",
  rusak_berat: "destructive",
};

/** Status Purchase Order: draft (belum mulai), ordered (menunggu barang), selesai (beres). */
export const poStatusVariant: Record<PoStatus, StatusBadgeVariant> = {
  draft: "secondary",
  ordered: "warning",
  received_partial: "warning",
  received: "success",
  cancelled: "destructive",
};

/** Status permintaan: diajukan/diproses (pending), disetujui/selesai (beres), ditolak (masalah). */
export const requestStatusVariant: Record<RequestStatus, StatusBadgeVariant> = {
  diajukan: "warning",
  disetujui: "success",
  disetujui_sebagian: "warning",
  ditolak: "destructive",
  diproses: "warning",
  selesai: "success",
};

/** Status per baris barang di dalam permintaan (dipakai detail tiket). */
export const requestItemStatusVariant: Record<string, StatusBadgeVariant> = {
  menunggu: "warning",
  disetujui: "success",
  ditolak: "destructive",
  diproses: "warning",
  siap: "success",
  terkirim: "success",
  pending_sebagian: "warning",
  menunggu_stok: "warning",
};

/** Status stok barang: habis (masalah), menipis (perhatian), aman (beres). */
export const stockStatusVariant: Record<StockStatus, StatusBadgeVariant> = {
  habis: "destructive",
  menipis: "warning",
  aman: "success",
};

/** Status stok per kondisi (Asset Baru/Return/Unready): HABIS merah, KRITIS kuning. */
export const kondisiStatusVariant: Record<KondisiStatus, StatusBadgeVariant> = {
  AMAN: "success",
  KRITIS: "warning",
  HABIS: "destructive",
};

/**
 * Versi kaca gelap dari badge yang sama (dipakai halaman Stok Kondisi yang
 * bertema gelap) — warna sama, hanya latarnya tembus pandang + teks pucat.
 * Dipakai sebagai className tambahan di atas `kondisiStatusVariant`.
 */
export const kondisiStatusDarkClass: Record<KondisiStatus, string> = {
  AMAN: "bg-ok-500/15 text-ok-100 ring-ok-500/25",
  KRITIS: "bg-warn-500/15 text-warn-100 ring-warn-500/25",
  HABIS: "bg-brand-500/15 text-brand-100 ring-brand-500/25",
};

/** Level peringatan stok: kritis (masalah), waspada (perhatian). */
export const alertLevelVariant: Record<AlertLevel, StatusBadgeVariant> = {
  kritis: "destructive",
  waspada: "warning",
};

/** Jenis sisa belum terkirim — keduanya pending (kuning). */
export const pendingJenisVariant: Record<PendingJenis, StatusBadgeVariant> = {
  "Belum Terkirim": "warning",
  "Menunggu Stok": "warning",
};
