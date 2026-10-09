import { z } from "zod";

export const assetSchema = z.object({
  asset_code: z
    .string()
    .min(1, "Kode aset wajib diisi")
    .max(50, "Kode aset maksimal 50 karakter")
    .regex(/^[A-Za-z0-9-_/.]+$/, "Kode aset hanya boleh huruf, angka, - _ / ."),
  name: z.string().min(1, "Nama aset wajib diisi").max(200),
  category_id: z.string().uuid("Kategori tidak valid").nullable().optional(),
  brand: z.string().max(100).nullable().optional(),
  model: z.string().max(100).nullable().optional(),
  serial_number: z.string().max(100).nullable().optional(),
  purchase_date: z.string().nullable().optional(),
  purchase_price: z
    .number({ invalid_type_error: "Harga harus angka" })
    .nonnegative("Harga tidak boleh negatif")
    .nullable()
    .optional(),
  location_id: z.string().uuid("Lokasi tidak valid").nullable().optional(),
  department_id: z.string().uuid("Departemen tidak valid").nullable().optional(),
  custodian: z.string().max(150).nullable().optional(),
  condition: z.enum(["baik", "rusak_ringan", "rusak_berat"]),
  status: z.enum([
    "tersedia",
    "digunakan",
    "dipinjamkan",
    "perbaikan",
    "rusak",
    "dipensiunkan",
  ]),
  photo_url: z.string().url("URL foto tidak valid").nullable().optional(),
  is_published: z.boolean().default(false),
});

export type AssetFormValues = z.infer<typeof assetSchema>;
