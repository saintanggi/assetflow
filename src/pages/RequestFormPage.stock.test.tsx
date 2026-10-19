import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u-1", email: "admin@contoh.id" },
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

const LOC_BARU = "loc-baru";
const LOC_RETUR = "loc-retur";

const DATA: Record<string, unknown[]> = {
  locations: [
    { id: LOC_BARU, code: "STOK-BARU", name: "Stok Barang Baru" },
    { id: LOC_RETUR, code: "STOK-RETUR", name: "Stok Barang Retur" },
  ],
  inventory_items: [{ id: "item-1", sku: "MON-01", name: "MONITOR" }],
  inventory_balances: [
    { item_id: "item-1", location_id: LOC_BARU, qty: 22 },
    { item_id: "item-1", location_id: LOC_RETUR, qty: 3 },
  ],
};

function makeQuery(table: string) {
  const result = { data: DATA[table] ?? [], error: null };
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "or", "order", "limit", "insert", "update"]) {
    builder[m] = () => builder;
  }
  builder.single = () => Promise.resolve({ data: (DATA[table] ?? [])[0] ?? null, error: null });
  // Supabase query builder ini "thenable" agar bisa di-await seperti aslinya.
  // oxlint-disable-next-line unicorn/no-thenable
  builder.then = (resolve: (v: unknown) => void) => resolve(result);
  return builder;
}

vi.mock("../lib/supabase", () => ({
  supabase: { from: (table: string) => makeQuery(table) },
}));

const { RequestFormPage } = await import("./RequestFormPage");

/** Ketik "MON" di kolom barang, lalu pilih hasil pertama (debounce 300 ms). */
async function searchAndPickMonitor(): Promise<HTMLElement> {
  const input = screen.getByPlaceholderText("Ketik nama / SKU barang…");
  fireEvent.change(input, { target: { value: "MON" } });
  const option = await waitFor(
    () => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("MON-01")
      );
      if (!btn) throw new Error("hasil pencarian barang belum muncul");
      return btn as HTMLElement;
    },
    { timeout: 2000 }
  );
  fireEvent.mouseDown(option);
  return option;
}

describe("RequestFormPage — sisa stok saat memilih barang", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("menampilkan sisa stok Baru & Retur di bawah barang yang dipilih", async () => {
    render(
      <MemoryRouter>
        <RequestFormPage />
      </MemoryRouter>
    );

    const option = await searchAndPickMonitor();
    expect(option.textContent).toContain("MON-01");

    await waitFor(() => {
      expect(screen.getByText(/Sisa stok:/)).toBeInTheDocument();
    });
    expect(screen.getByText("Baru 22")).toBeInTheDocument();
    // eslint-disable-next-line no-console
    expect(screen.getByText("Retur 3")).toBeInTheDocument();
    // Panel Status Asset juga menampilkan lokasi pemotong + saldonya.
    expect(screen.getByText(/Sisa di lokasi ini:/)).toBeInTheDocument();
    expect(screen.getByText("STOK-BARU")).toBeInTheDocument();
  });

  it("memperingatkan bila qty melebihi stok lokasi pemotong", async () => {
    render(
      <MemoryRouter>
        <RequestFormPage />
      </MemoryRouter>
    );

    await searchAndPickMonitor();

    await waitFor(() => expect(screen.getByText(/Sisa stok:/)).toBeInTheDocument());

    // Status Asset default ASSET BARU -> lokasi STOK-BARU berisi 22.
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "30" } });

    await waitFor(() => {
      expect(screen.getByText(/melebihi stok STOK-BARU \(22\)/)).toBeInTheDocument();
    });
  });
});
