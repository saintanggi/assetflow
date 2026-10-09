import { z } from "zod";

export const inventoryItemSchema = z.object({
  sku: z
    .string()
    .min(1, "SKU wajib diisi")
    .max(50, "SKU maksimal 50 karakter")
    .regex(/^[A-Za-z0-9-_/.]+$/, "SKU hanya boleh huruf, angka, - _ / ."),
  name: z.string().min(1, "Nama barang wajib diisi").max(200),
  category_id: z.string().uuid("Kategori tidak valid").nullable().optional(),
  brand: z.string().max(100).nullable().optional(),
  model: z.string().max(100).nullable().optional(),
  unit_id: z.string().uuid("Satuan tidak valid").nullable().optional(),
  barcode: z.string().max(50).nullable().optional(),
  min_stock: z
    .number({ invalid_type_error: "Stok minimum harus angka" })
    .nonnegative("Stok minimum tidak boleh negatif")
    .nullable()
    .optional(),
  location_id: z.string().uuid("Lokasi tidak valid").nullable().optional(),
  supplier_id: z.string().uuid("Pemasok tidak valid").nullable().optional(),
  purchase_price: z
    .number({ invalid_type_error: "Harga beli harus angka" })
    .nonnegative("Harga beli tidak boleh negatif")
    .nullable()
    .optional(),
  is_active: z.boolean().default(true),
  photo_url: z.string().url("URL foto tidak valid").nullable().optional(),
});

export type InventoryItemFormValues = z.infer<typeof inventoryItemSchema>;
