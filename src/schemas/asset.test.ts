import { describe, expect, it } from "vitest";
import { assetSchema } from "./asset";
import { inventoryItemSchema } from "./inventory";
import { transactionSchema } from "./transaction";

const validAsset = {
  asset_code: "AST-0001",
  name: "Laptop ThinkPad",
  condition: "baik",
  status: "tersedia",
  is_published: false,
};

describe("assetSchema", () => {
  it("menerima data aset yang valid", () => {
    const r = assetSchema.safeParse(validAsset);
    expect(r.success).toBe(true);
  });

  it("menolak kode aset kosong", () => {
    const r = assetSchema.safeParse({ ...validAsset, asset_code: "" });
    expect(r.success).toBe(false);
  });

  it("menolak kode aset dengan karakter ilegal", () => {
    const r = assetSchema.safeParse({ ...validAsset, asset_code: "AST 001!" });
    expect(r.success).toBe(false);
  });

  it("menolak kondisi di luar enum", () => {
    const r = assetSchema.safeParse({ ...validAsset, condition: "bagus-sekali" });
    expect(r.success).toBe(false);
  });

  it("menolak harga negatif", () => {
    const r = assetSchema.safeParse({ ...validAsset, purchase_price: -100 });
    expect(r.success).toBe(false);
  });
});

describe("inventoryItemSchema", () => {
  it("menerima barang yang valid", () => {
    const r = inventoryItemSchema.safeParse({
      sku: "ATK-PEN-001",
      name: "Pulpen",
      is_active: true,
    });
    expect(r.success).toBe(true);
  });

  it("menolak SKU kosong dan stok minimum negatif", () => {
    expect(inventoryItemSchema.safeParse({ sku: "", name: "x", is_active: true }).success).toBe(false);
    expect(
      inventoryItemSchema.safeParse({ sku: "A", name: "x", min_stock: -1, is_active: true }).success
    ).toBe(false);
  });
});

describe("transactionSchema", () => {
  const line = { item_id: "123e4567-e89b-12d3-a456-426614174000", qty: 5 };

  it("menerima transaksi valid dengan satu baris", () => {
    const r = transactionSchema.safeParse({
      transaction_date: "2026-10-09",
      items: [line],
    });
    expect(r.success).toBe(true);
  });

  it("menolak transaksi tanpa baris barang", () => {
    const r = transactionSchema.safeParse({ transaction_date: "2026-10-09", items: [] });
    expect(r.success).toBe(false);
  });

  it("menolak qty nol atau negatif", () => {
    const r = transactionSchema.safeParse({
      transaction_date: "2026-10-09",
      items: [{ ...line, qty: 0 }],
    });
    expect(r.success).toBe(false);
  });
});
