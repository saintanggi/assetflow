import { z } from "zod";

export const transactionLineSchema = z.object({
  item_id: z.string().uuid("Barang tidak valid"),
  qty: z
    .number({ invalid_type_error: "Qty harus angka" })
    .positive("Qty harus lebih dari 0"),
  unit_price: z.number().nonnegative().nullable().optional(),
  notes: z.string().max(255).nullable().optional(),
});

export const transactionSchema = z.object({
  transaction_date: z.string().min(1, "Tanggal wajib diisi"),
  source_location_id: z.string().uuid().nullable().optional(),
  dest_location_id: z.string().uuid().nullable().optional(),
  reference: z.string().max(100).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  items: z.array(transactionLineSchema).min(1, "Minimal satu barang"),
});

export type TransactionFormValues = z.infer<typeof transactionSchema>;
export type TransactionLineValues = z.infer<typeof transactionLineSchema>;

export const stockCountLineSchema = z.object({
  item_id: z.string().uuid(),
  system_qty: z.number(),
  counted_qty: z
    .number({ invalid_type_error: "Qty hasil hitung harus angka" })
    .nonnegative("Qty tidak boleh negatif"),
});

export const stockCountSchema = z.object({
  location_id: z.string().uuid("Lokasi wajib dipilih"),
  notes: z.string().max(500).nullable().optional(),
  items: z.array(stockCountLineSchema).min(1, "Minimal satu barang"),
});

export type StockCountFormValues = z.infer<typeof stockCountSchema>;
