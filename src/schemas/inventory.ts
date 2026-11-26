import { z } from "zod";

export const inventoryItemSchema = z.object({
  sku: z
    .string()
    .max(50, "SKU maksimal 50 karakter")
    .regex(/^[A-Za-z0-9-_/.]*$/, "SKU hanya boleh huruf, angka, - _ / .")
    .optional(),
  name: z.string().trim().min(1, "Nama barang wajib diisi").max(200),
  category_id: z.string().uuid("Kategori tidak valid").nullable().optional(),
  brand: z.string().trim().max(100, "Merek maksimal 100 karakter").nullable().optional(),
  model: z.string().trim().max(100, "Model maksimal 100 karakter").nullable().optional(),
  unit_id: z.string().uuid("Satuan tidak valid").nullable().optional(),
  barcode: z.string().trim().max(50, "Barcode maksimal 50 karakter").nullable().optional(),
  min_stock: z
    .number({ error: "Stok minimum harus angka" })
    .nonnegative("Stok minimum tidak boleh negatif")
    .nullable()
    .optional()
    .transform((v) => v ?? 0),
  location_id: z.string().uuid("Lokasi tidak valid").nullable().optional(),
  supplier_id: z.string().uuid("Pemasok tidak valid").nullable().optional(),
  purchase_price: z
    .number({ error: "Harga beli harus angka" })
    .nonnegative("Harga beli tidak boleh negatif")
    .nullable()
    .optional(),
  is_active: z.boolean().default(true),
  photo_url: z.string().url("URL foto tidak valid").nullable().optional(),
});

export type InventoryItemFormValues = z.infer<typeof inventoryItemSchema>;
