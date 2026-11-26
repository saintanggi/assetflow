import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const CAT_ID = "11111111-1111-4111-8111-111111111111";
const UNIT_ID = "22222222-2222-4222-8222-222222222222";
const PCS_ID = "33333333-3333-4333-8333-333333333333";

const mocks = vi.hoisted(() => ({
  insertedPayloads: [] as Record<string, unknown>[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u-1", email: "saint.anggi@gmail.com" },
    profile: null,
    permissions: [],
    loading: false,
    isSuperAdmin: true,
    isStaff: true,
    hasPermission: () => true,
    signIn: vi.fn(),
    signOut: vi.fn(),
    refreshProfile: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

const TABLE_DATA: Record<string, unknown[]> = {
  inventory_items: [],
  inventory_balances: [],
  locations: [],
  asset_categories: [{ id: CAT_ID, code: "ELK", name: "Elektronik", is_active: true }],
  units: [
    { id: PCS_ID, code: "pcs", name: "Pcs" },
    { id: UNIT_ID, code: "unit", name: "Unit" },
  ],
  suppliers: [],
};

function makeQuery(table: string) {
  let activeData = TABLE_DATA[table] ?? [];
  let isLikeSku = false;
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit", "ilike", "range"]) {
    builder[m] = () => builder;
  }
  builder.like = (col: string) => {
    if (table === "inventory_items" && col === "sku") {
      isLikeSku = true;
      activeData = [{ sku: "KIP-008" }];
    }
    return builder;
  };
  builder.maybeSingle = () =>
    Promise.resolve({ data: activeData[0] ?? null, error: null });
  builder.insert = (payload: Record<string, unknown>) => {
    mocks.insertedPayloads.push(payload);
    return Promise.resolve({ data: null, error: null });
  };
  // oxlint-disable-next-line unicorn/no-thenable
  builder.then = (resolve: (v: unknown) => void) =>
    resolve({ data: isLikeSku ? [{ sku: "KIP-008" }] : activeData, error: null });
  return builder;
}

vi.mock("../lib/supabase", () => ({
  supabase: {
    from: (table: string) => makeQuery(table),
    storage: {
      from: () => ({
        upload: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: "https://example.com/p.jpg" } }),
      }),
    },
  },
}));

const { InventoryListPage } = await import("./InventoryListPage");

describe("InventoryListPage — Tambah Barang", () => {
  beforeEach(() => {
    mocks.insertedPayloads.length = 0;
    vi.clearAllMocks();
  });

  it("mengisi min_stock = 0 (bukan null) saat Stok Minimum dikosongkan", async () => {
    render(
      <MemoryRouter>
        <InventoryListPage />
      </MemoryRouter>
    );

    const addBtn = await screen.findByRole("button", { name: /Tambah/i });
    fireEvent.click(addBtn);

    await screen.findByText("Tambah Barang");
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Elektronik" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "UNIT" })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Nama Barang *"), {
      target: { value: 'Kipas Angin Wall 20" Sekai IWF 2038' },
    });
    fireEvent.change(screen.getByLabelText("Kategori"), {
      target: { value: CAT_ID },
    });
    fireEvent.change(screen.getByLabelText("Satuan"), {
      target: { value: UNIT_ID },
    });
    fireEvent.change(screen.getByLabelText("Merek"), {
      target: { value: "SEKAI" },
    });
    fireEvent.change(screen.getByLabelText("Model"), {
      target: { value: "IWF 2038" },
    });
    // Biarkan Stok Minimum dan Harga Beli kosong (placeholder 0).

    fireEvent.click(screen.getByRole("button", { name: "Simpan" }));

    await waitFor(() => {
      expect(mocks.insertedPayloads).toHaveLength(1);
    });

    expect(mocks.insertedPayloads[0]).toMatchObject({
      sku: "KIP-009",
      name: 'Kipas Angin Wall 20" Sekai IWF 2038',
      category_id: CAT_ID,
      unit_id: UNIT_ID,
      brand: "SEKAI",
      model: "IWF 2038",
      barcode: null,
      min_stock: 0,
      purchase_price: null,
      is_active: true,
    });
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Barang berhasil ditambahkan");
  });

  it("tetap menyimpan angka min_stock dan purchase_price jika diisi user", async () => {
    render(
      <MemoryRouter>
        <InventoryListPage />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole("button", { name: /Tambah/i }));
    await screen.findByText("Tambah Barang");

    fireEvent.change(screen.getByLabelText("Nama Barang *"), {
      target: { value: "Kabel UTP Cat6" },
    });
    fireEvent.change(screen.getByLabelText("Stok Minimum"), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByLabelText("Harga Beli (Rp)"), {
      target: { value: "250000" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Simpan" }));

    await waitFor(() => {
      expect(mocks.insertedPayloads).toHaveLength(1);
    });

    expect(mocks.insertedPayloads[0]).toMatchObject({
      name: "Kabel UTP Cat6",
      min_stock: 5,
      purchase_price: 250000,
    });
  });

  it("menolak Stok Minimum negatif tanpa mengirim ke server", async () => {
    render(
      <MemoryRouter>
        <InventoryListPage />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole("button", { name: /Tambah/i }));
    await screen.findByText("Tambah Barang");

    fireEvent.change(screen.getByLabelText("Nama Barang *"), {
      target: { value: "Kabel UTP Cat6" },
    });
    fireEvent.change(screen.getByLabelText("Stok Minimum"), {
      target: { value: "-2" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Simpan" }));

    expect(
      await screen.findByText("Stok minimum tidak boleh negatif")
    ).toBeInTheDocument();
    expect(mocks.insertedPayloads).toHaveLength(0);
  });
});
