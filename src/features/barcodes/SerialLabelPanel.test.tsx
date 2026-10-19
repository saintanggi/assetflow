import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SerialLabelPanel } from "./SerialLabelPanel";

const mocks = vi.hoisted(() => ({ allocate: vi.fn(), fetch: vi.fn(), print: vi.fn(), from: vi.fn() }));
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-a" } }) }));
vi.mock("../../lib/supabase", () => ({ supabase: { from: mocks.from } }));
vi.mock("./serialLabels", async (importOriginal) => ({
  ...await importOriginal<typeof import("./serialLabels")>(),
  allocateSerialLabels: mocks.allocate, fetchBatchLabels: mocks.fetch,
}));
vi.mock("./printSerialLabels", () => ({ printSerialLabels: mocks.print }));

const rows = [
  { number: 1, code: "000000000001", batch_id: "batch-a" },
  { number: 2, code: "000000000002", batch_id: "batch-a" },
];
const storageKey = "assetflow:qr-request:user-a";

function mount() {
  return render(<MemoryRouter initialEntries={["/label?sku=item-a"]}><SerialLabelPanel /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  mocks.allocate.mockResolvedValue(rows);
  mocks.fetch.mockResolvedValue(rows);
  mocks.print.mockResolvedValue(undefined);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  mocks.from.mockImplementation((table: string) => {
    const data = table === "inventory_items" ? { id: "item-a", sku: "MON", name: "Monitor" }
      : table === "qr_label_batches" ? [{ id: "batch-a", title: "Monitor", quantity: 2, item_id: "item-a", asset_id: null, created_at: "2026-10-19T00:00:00Z", created_by: "user-b" }] : [];
    const result = { data, error: null };
    const chain: Record<string, unknown> = {};
    for (const key of ["select", "eq", "order", "range", "limit", "or"]) chain[key] = () => chain;
    chain.maybeSingle = () => Promise.resolve(result);
    chain.then = (resolve: (r: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return chain;
  });
});

describe("mesin cetak QR", () => {
  it("simpan lebih dulu, cetak eksplisit tanpa memesan nomor lagi", async () => {
    mount();
    await screen.findByText(/Dipilih:/);
    fireEvent.change(screen.getByLabelText("Jumlah unit / label"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Simpan & buat nomor" }));
    const print = await screen.findByRole("button", { name: "Cetak 2 label" });
    expect(mocks.allocate).toHaveBeenCalledTimes(1);
    expect(mocks.allocate.mock.calls[0][0]).toMatchObject({ quantity: 2, target: { id: "item-a", kind: "item" } });
    expect(sessionStorage.getItem(storageKey)).toBeNull();
    expect(mocks.print).not.toHaveBeenCalled();
    fireEvent.click(print);
    await waitFor(() => expect(mocks.print).toHaveBeenCalledWith(["000000000001", "000000000002"], { preset: "photo", header: "SiCepat" }));
    expect(mocks.allocate).toHaveBeenCalledTimes(1);
  });

  it("respons hilang: kunci request tetap sama, bahkan setelah remount", async () => {
    mocks.allocate.mockRejectedValueOnce(new Error("Network failed"));
    const first = mount();
    await screen.findByText(/Dipilih:/);
    fireEvent.click(screen.getByRole("button", { name: "Simpan & buat nomor" }));
    await screen.findByText("Network failed");
    const request = mocks.allocate.mock.calls[0][0];
    expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toEqual(request);
    first.unmount();
    mount();
    expect(screen.getByLabelText("Jumlah unit / label")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi (permintaan yang sama)" }));
    await screen.findByRole("button", { name: "Cetak 2 label" });
    expect(mocks.allocate.mock.calls[1][0]).toEqual(request);
    expect(sessionStorage.getItem(storageKey)).toBeNull();
  });

  it("cetak ulang dapat memilih satu nomor batch milik pengguna lain", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Buka / cetak ulang" }));
    await screen.findByRole("button", { name: "Cetak 2 label" });
    fireEvent.click(screen.getByLabelText("Pilih 000000000001"));
    fireEvent.click(screen.getByRole("button", { name: "Cetak 1 label" }));
    await waitFor(() => expect(mocks.print).toHaveBeenCalledWith(["000000000002"], { preset: "photo", header: "SiCepat" }));
    expect(mocks.fetch).toHaveBeenCalledWith("batch-a");
    expect(mocks.allocate).not.toHaveBeenCalled();
  });

  it("template 100 × 150 mengikuti pilihan pengguna dan tetap memakai nomor tersimpan", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Buka / cetak ulang" }));
    await screen.findByRole("button", { name: "Cetak 2 label" });
    fireEvent.change(screen.getByLabelText("Susunan per lembar"), { target: { value: "compact" } });
    fireEvent.change(screen.getByLabelText("Tulisan atas label"), { target: { value: "GUDANG" } });
    const preview = screen.getByTestId("serial-sheet-preview");
    expect(preview.querySelectorAll(".serial-label-sheet")).toHaveLength(1);
    expect(preview.querySelectorAll(".serial-qr-label")).toHaveLength(2);
    const sheet = preview.querySelector<HTMLElement>(".serial-label-sheet")!;
    expect(sheet.style.width).toBe("100mm");
    expect(sheet.style.height).toBe("150mm");
    expect(preview.querySelector(".serial-label-header")).toHaveTextContent("GUDANG");
    expect(screen.getByRole("status")).toHaveTextContent("1 lembar · 32 label per lembar");
    fireEvent.click(screen.getByRole("button", { name: "Cetak 2 label" }));
    await waitFor(() => expect(mocks.print).toHaveBeenCalledWith(["000000000001", "000000000002"], { preset: "compact", header: "GUDANG" }));
    expect(mocks.allocate).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem("assetflow:qr-sheet-template:v1")!)).toEqual({ preset: "compact", header: "GUDANG" });
  });

  it("menolak jumlah desimal dan tidak memanggil server", async () => {
    mount();
    await screen.findByText(/Dipilih:/);
    fireEvent.change(screen.getByLabelText("Jumlah unit / label"), { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Simpan & buat nomor" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("jumlah bulat 1–500");
    expect(mocks.allocate).not.toHaveBeenCalled();
  });
});
