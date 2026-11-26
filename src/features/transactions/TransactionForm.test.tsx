import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const ITEM_ID = "11111111-1111-4111-8111-111111111111";
const LOC_BARU_ID = "22222222-2222-4222-8222-222222222222";

const mocks = vi.hoisted(() => ({
  uploads: [] as { path: string; file: File }[],
  rpcCalls: [] as { fn: string; params: Record<string, unknown> }[],
  rpcErrorOnce: null as string | null,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

const TABLE_DATA: Record<string, unknown[]> = {
  locations: [
    {
      id: LOC_BARU_ID,
      code: "STOK-BARU",
      name: "Stok Baru",
      warehouses: { name: "Gudang Utama" },
    },
  ],
  requests: [{ branch_name: "Gerai Jakarta" }],
  inventory_items: [{ id: ITEM_ID, sku: "KIP-001", name: "Kipas Angin" }],
  inventory_balances: [{ item_id: ITEM_ID, available_qty: 20 }],
};

function makeQuery(table: string) {
  const activeData = TABLE_DATA[table] ?? [];
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "not", "or", "order", "limit", "range"]) {
    builder[m] = () => builder;
  }
  // oxlint-disable-next-line unicorn/no-thenable
  builder.then = (resolve: (v: unknown) => void) =>
    resolve({ data: activeData, error: null });
  return builder;
}

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: (table: string) => makeQuery(table),
    storage: {
      from: () => ({
        upload: async (path: string, file: File) => {
          mocks.uploads.push({ path, file });
          return { error: null };
        },
        getPublicUrl: (path: string) => ({
          data: {
            publicUrl: `https://proj.supabase.co/storage/v1/object/public/surat-jalan/${path}`,
          },
        }),
      }),
    },
    rpc: async (fn: string, params: Record<string, unknown>) => {
      mocks.rpcCalls.push({ fn, params });
      if (mocks.rpcErrorOnce) {
        const msg = mocks.rpcErrorOnce;
        mocks.rpcErrorOnce = null;
        return { data: null, error: { message: msg } };
      }
      return { data: "IN-2026-000099", error: null };
    },
  },
}));

const { TransactionForm } = await import("./TransactionForm");

async function pickBarangAndJenis(jenis = "baru") {
  await waitFor(() => {
    expect(screen.getByLabelText("Jenis Stok")).toBeInTheDocument();
  });
  fireEvent.change(screen.getByLabelText("Jenis Stok"), {
    target: { value: jenis },
  });

  const searchInput = screen.getByPlaceholderText(/Ketik SKU \/ nama barang/i);
  fireEvent.change(searchInput, { target: { value: "kipas" } });
  await waitFor(() => {
    expect(screen.getByText("KIP-001")).toBeInTheDocument();
  });
  fireEvent.mouseDown(screen.getByText("KIP-001").closest("button")!);
  fireEvent.change(screen.getByLabelText("Qty baris 1"), { target: { value: "5" } });
}

describe("TransactionForm — multi foto surat jalan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.uploads = [];
    mocks.rpcCalls = [];
    mocks.rpcErrorOnce = null;
    if (!URL.createObjectURL) {
      URL.createObjectURL = vi.fn(() => "blob:mock-preview");
    } else {
      vi.spyOn(URL, "createObjectURL").mockImplementation(
        () => `blob:mock-${Math.random().toString(36).slice(2)}`
      );
    }
    if (!URL.revokeObjectURL) {
      URL.revokeObjectURL = vi.fn();
    } else {
      vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    }
  });

  it("mewajibkan minimal 1 foto bukti pada Barang Masuk dan Barang Keluar", async () => {
    const { rerender } = render(
      <TransactionForm
        typeLabel="Barang Masuk"
        type="in"
        needSource={false}
        needDest={true}
        submitLabel="Simpan Barang Masuk"
      />
    );
    await pickBarangAndJenis("baru");
    fireEvent.click(screen.getByRole("button", { name: "Simpan Barang Masuk" }));
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Minimal 1 foto Surat Jalan atau No PO wajib dilampirkan untuk Barang Masuk."
    );
    expect(mocks.rpcCalls).toHaveLength(0);

    rerender(
      <TransactionForm
        typeLabel="Barang Keluar"
        type="out"
        needSource={true}
        needDest={false}
        submitLabel="Simpan Barang Keluar"
      />
    );
    await pickBarangAndJenis("baru");
    fireEvent.click(screen.getByRole("button", { name: "Simpan Barang Keluar" }));
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Minimal 1 foto Surat Jalan wajib dilampirkan untuk Barang Keluar."
    );
  });

  it("mengunggah banyak foto SJ (pilih banyak + tambah lagi + hapus) dan mengirim JSON array URL ke RPC", async () => {
    render(
      <TransactionForm
        typeLabel="Barang Masuk"
        type="in"
        needSource={false}
        needDest={true}
        submitLabel="Simpan Barang Masuk"
      />
    );
    await pickBarangAndJenis("baru");

    const fileInput = document.getElementById("trx-sj-photo") as HTMLInputElement;
    expect(fileInput.multiple).toBe(true);

    const f1 = new File(["img1"], "sj-1.jpg", { type: "image/jpeg" });
    const f2 = new File(["img2"], "sj-2.png", { type: "image/png" });
    const f3 = new File(["img3"], "sj-3.webp", { type: "image/webp" });

    // Pilih 2 file sekaligus
    fireEvent.change(fileInput, { target: { files: [f1, f2] } });
    expect(screen.getByText("2/10 foto terlampir")).toBeInTheDocument();

    // Tambah 1 file lagi lewat tombol yang sama (tidak menimpa foto sebelumnya)
    fireEvent.change(fileInput, { target: { files: [f3] } });
    expect(screen.getByText("3/10 foto terlampir")).toBeInTheDocument();

    // Hapus foto ke-2
    fireEvent.click(screen.getByRole("button", { name: "Hapus foto 2" }));
    expect(screen.getByText("2/10 foto terlampir")).toBeInTheDocument();

    // Simulasikan gagal RPC sekali lalu retry — foto tidak diupload ulang
    mocks.rpcErrorOnce = "Koneksi timeout";
    fireEvent.click(screen.getByRole("button", { name: "Simpan Barang Masuk" }));
    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith("Koneksi timeout");
    });
    expect(mocks.uploads).toHaveLength(2);

    // Retry submit
    fireEvent.click(screen.getByRole("button", { name: "Simpan Barang Masuk" }));
    await waitFor(() => {
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        "Transaksi IN-2026-000099 berhasil diposting"
      );
    });
    // Tidak ada upload duplikat saat retry
    expect(mocks.uploads).toHaveLength(2);
    expect(mocks.rpcCalls).toHaveLength(2);

    const lastPayload = mocks.rpcCalls[1].params.p_surat_jalan_url as string;
    const parsed = JSON.parse(lastPayload);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatch(/surat-jalan\/.*\.jpg$/);
    expect(parsed[1]).toMatch(/surat-jalan\/.*\.webp$/);
  });

  it("tetap menyimpan string URL tunggal jika hanya 1 foto yang dilampirkan (kompatibel data lama)", async () => {
    render(
      <TransactionForm
        typeLabel="Barang Keluar"
        type="out"
        needSource={true}
        needDest={false}
        submitLabel="Simpan Barang Keluar"
      />
    );
    await pickBarangAndJenis("baru");

    const fileInput = document.getElementById("trx-sj-photo") as HTMLInputElement;
    const f1 = new File(["img1"], "sj-tunggal.jpg", { type: "image/jpeg" });
    fireEvent.change(fileInput, { target: { files: [f1] } });
    expect(screen.getByText("1/10 foto terlampir")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Simpan Barang Keluar" }));
    await waitFor(() => {
      expect(mocks.rpcCalls).toHaveLength(1);
    });
    const sjUrl = mocks.rpcCalls[0].params.p_surat_jalan_url as string;
    expect(sjUrl.startsWith("https://")).toBe(true);
    expect(sjUrl.startsWith("[")).toBe(false);
  });

  it("mendukung tempel (paste) gambar berkali-kali dari clipboard tanpa menimpa foto sebelumnya", async () => {
    render(
      <TransactionForm
        typeLabel="Barang Masuk"
        type="in"
        needSource={false}
        needDest={true}
        submitLabel="Simpan Barang Masuk"
      />
    );
    await waitFor(() => {
      expect(screen.getByLabelText("Jenis Stok")).toBeInTheDocument();
    });

    const pasteImg1 = new File(["p1"], "image.png", { type: "image/png" });
    const pasteImg2 = new File(["p2"], "image.png", { type: "image/png" });

    for (const file of [pasteImg1, pasteImg2]) {
      const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(event, "clipboardData", {
        value: {
          items: [
            {
              type: file.type,
              getAsFile: () => file,
            },
          ],
        },
      });
      fireEvent(document, event);
    }

    await waitFor(() => {
      expect(screen.getByText("2/10 foto terlampir")).toBeInTheDocument();
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Foto dari clipboard ditambahkan (total 2 foto)."
    );
  });
});
