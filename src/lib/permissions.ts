/** Daftar permission codes — HARUS sama dengan tabel `permissions` di database. */

export const PERMISSIONS = [
  { code: "assets.view", description: "Melihat daftar & detail aset tetap" },
  { code: "assets.create", description: "Menambah aset tetap baru" },
  { code: "assets.update", description: "Mengubah data aset tetap" },
  { code: "assets.archive", description: "Mengarsipkan aset tetap" },
  { code: "assets.publish", description: "Menyetujui publikasi aset (khusus Super Admin)" },
  { code: "inventory.view", description: "Melihat persediaan & riwayat transaksi" },
  { code: "inventory.receive", description: "Mencatat barang masuk" },
  { code: "inventory.issue", description: "Mencatat barang keluar" },
  { code: "inventory.transfer", description: "Mencatat transfer antar lokasi" },
  { code: "inventory.adjust", description: "Penyesuaian stok & stock opname" },
  { code: "reports.view", description: "Melihat laporan" },
  { code: "reports.export", description: "Mengekspor laporan (CSV/Excel/cetak)" },
  { code: "labels.print", description: "Mencetak label QR / barcode" },
  { code: "users.manage", description: "Mengelola akun admin & permission" },
  { code: "settings.manage", description: "Mengelola master data & konfigurasi" },
  { code: "audit.view", description: "Melihat audit log" },
] as const;

export type PermissionCode = (typeof PERMISSIONS)[number]["code"];

/** Permission publikasi hanya boleh diberikan oleh Super Admin.
 *  Aturan ini ditegakkan di database (RPC/trigger); UI hanya menyembunyikan
 *  kontrolnya untuk non-super-admin sebagai lapisan tambahan. */
export const PUBLISH_PERMISSION: PermissionCode = "assets.publish";

export const ALL_PERMISSION_CODES: string[] = PERMISSIONS.map((p) => p.code);
