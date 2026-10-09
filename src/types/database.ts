/**
 * Tipe baris database AssetFlow.
 * HARUS cocok dengan kontrak di docs/IMPLEMENTATION_PLAN.md.
 * Jangan menambah kolom fiktif — hanya yang ada di migrasi.
 */

export type AssetCondition = "baik" | "rusak_ringan" | "rusak_berat";
export type AssetStatus =
  | "tersedia"
  | "digunakan"
  | "dipinjamkan"
  | "perbaikan"
  | "rusak"
  | "dipensiunkan";
export type TransactionType = "in" | "out" | "transfer" | "adjust" | "opname" | "return";
export type TransactionStatus = "draft" | "posted" | "reversed";
export type StockCountStatus = "draft" | "posted";

export interface Role {
  id: string;
  name: "super_admin" | "admin";
  created_at: string;
  updated_at: string;
}

export interface Permission {
  id: string;
  code: string;
  description: string | null;
  created_at: string;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  roles?: Pick<Role, "name"> | null;
}

export interface RolePermission {
  role_id: string;
  permission_id: string;
}

export interface UserPermission {
  user_id: string;
  permission_id: string;
  granted: boolean;
  granted_by: string | null;
  granted_at: string;
}

export interface AssetCategory {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  address: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Location {
  id: string;
  warehouse_id: string;
  code: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  warehouses?: Pick<Warehouse, "code" | "name"> | null;
}

export interface Unit {
  id: string;
  code: string;
  name: string;
  allow_decimal: boolean;
  created_at: string;
  updated_at: string;
}

export interface Department {
  id: string;
  code: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Supplier {
  id: string;
  code: string;
  name: string;
  contact: string | null;
  phone: string | null;
  address: string | null;
  created_at: string;
  updated_at: string;
}

export interface Asset {
  id: string;
  asset_code: string;
  public_code: string;
  name: string;
  category_id: string | null;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  purchase_date: string | null;
  purchase_price: number | null;
  location_id: string | null;
  department_id: string | null;
  custodian: string | null;
  condition: AssetCondition;
  status: AssetStatus;
  photo_url: string | null;
  is_published: boolean;
  published_at: string | null;
  published_by: string | null;
  archived: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // relasi opsional (diisi via join select)
  asset_categories?: Pick<AssetCategory, "code" | "name"> | null;
  locations?: (Pick<Location, "code" | "name"> & {
    warehouses?: Pick<Warehouse, "code" | "name"> | null;
  }) | null;
  departments?: Pick<Department, "code" | "name"> | null;
}

export interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  category_id: string | null;
  brand: string | null;
  model: string | null;
  unit_id: string | null;
  barcode: string | null;
  min_stock: number | null;
  location_id: string | null;
  supplier_id: string | null;
  purchase_price: number | null;
  is_active: boolean;
  photo_url: string | null;
  created_at: string;
  updated_at: string;
  asset_categories?: Pick<AssetCategory, "code" | "name"> | null;
  units?: Pick<Unit, "code" | "name"> | null;
  locations?: Pick<Location, "code" | "name"> | null;
  suppliers?: Pick<Supplier, "code" | "name"> | null;
}

export interface InventoryBalance {
  item_id: string;
  location_id: string;
  qty: number;
  updated_at: string;
}

export interface InventoryTransaction {
  id: string;
  doc_number: string;
  type: TransactionType;
  status: TransactionStatus;
  transaction_date: string;
  source_location_id: string | null;
  dest_location_id: string | null;
  reference: string | null;
  notes: string | null;
  idempotency_key: string;
  created_by: string | null;
  posted_at: string | null;
  reversed_at: string | null;
  reversal_of: string | null;
  reversal_reason: string | null;
  created_at: string;
  updated_at: string;
  inventory_transaction_items?: InventoryTransactionItem[];
}

export interface InventoryTransactionItem {
  id: string;
  transaction_id: string;
  item_id: string;
  qty: number;
  unit_price: number | null;
  notes: string | null;
  inventory_items?: Pick<InventoryItem, "sku" | "name"> & {
    units?: Pick<Unit, "code"> | null;
  };
}

export interface InventoryLedger {
  id: string;
  transaction_id: string;
  item_id: string;
  location_id: string;
  qty_change: number;
  qty_after: number;
  created_at: string;
}

export interface AssetMovement {
  id: string;
  asset_id: string;
  from_location_id: string | null;
  to_location_id: string | null;
  from_status: string | null;
  to_status: string | null;
  moved_by: string | null;
  notes: string | null;
  created_at: string;
}

export interface StockCount {
  id: string;
  doc_number: string;
  location_id: string;
  status: StockCountStatus;
  counted_by: string | null;
  notes: string | null;
  posted_at: string | null;
  created_at: string;
  updated_at: string;
  stock_count_items?: StockCountItem[];
}

export interface StockCountItem {
  id: string;
  stock_count_id: string;
  item_id: string;
  system_qty: number;
  counted_qty: number;
  inventory_items?: Pick<InventoryItem, "sku" | "name"> & {
    units?: Pick<Unit, "code"> | null;
  };
}

export interface AuditLog {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  created_at: string;
  profiles?: Pick<Profile, "email" | "full_name"> | null;
}

export interface AppSetting {
  key: string;
  value: unknown;
  updated_at: string;
}

/**
 * Whitelist kolom publik — HANYA kolom ini yang boleh keluar lewat
 * RPC get_public_asset / search_public_assets. Jangan tambah kolom privat.
 */
export interface PublicAsset {
  public_code: string;
  name: string;
  category_name: string | null;
  brand: string | null;
  model: string | null;
  condition: AssetCondition | null;
  status: AssetStatus | null;
  photo_url: string | null;
  department_name: string | null;
  published_at: string | null;
}

/** Item baris untuk RPC post_inventory_transaction (p_items jsonb). */
export interface TransactionItemInput {
  item_id: string;
  qty: number;
  unit_price?: number | null;
  notes?: string | null;
}

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  tersedia: "Tersedia",
  digunakan: "Digunakan",
  dipinjamkan: "Dipinjamkan",
  perbaikan: "Dalam Perbaikan",
  rusak: "Rusak",
  dipensiunkan: "Dipensiunkan",
};

export const ASSET_CONDITION_LABELS: Record<AssetCondition, string> = {
  baik: "Baik",
  rusak_ringan: "Rusak Ringan",
  rusak_berat: "Rusak Berat",
};

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  in: "Barang Masuk",
  out: "Barang Keluar",
  transfer: "Transfer",
  adjust: "Penyesuaian",
  opname: "Stock Opname",
  return: "Retur",
};

export const TRANSACTION_STATUS_LABELS: Record<TransactionStatus, string> = {
  draft: "Draft",
  posted: "Diposting",
  reversed: "Dibatalkan",
};
