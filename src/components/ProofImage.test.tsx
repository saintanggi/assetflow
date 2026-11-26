import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  createSignedUrl: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  supabase: {
    storage: {
      from: () => ({
        createSignedUrl: mocks.createSignedUrl,
      }),
    },
  },
}));

const { ProofImage } = await import("./ProofImage");

describe("ProofImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSignedUrl.mockImplementation(async (path: string) => ({
      data: { signedUrl: `https://signed.example.com/${path}?token=abc` },
      error: null,
    }));
  });

  it("menampilkan placeholder saat tidak ada foto", () => {
    const { rerender } = render(<ProofImage url={null} variant="thumb" />);
    expect(screen.getByText("—")).toBeInTheDocument();

    rerender(<ProofImage url={null} variant="large" />);
    expect(screen.getByText("Belum ada foto surat jalan.")).toBeInTheDocument();
  });

  it("tetap mendukung 1 URL lama secara normal", async () => {
    render(
      <ProofImage
        url="https://proj.supabase.co/storage/v1/object/public/surat-jalan/legacy-1.png"
        label="IN-2026-000001"
        variant="thumb"
      />
    );

    const btn = screen.getByRole("button", { name: "Lihat foto surat jalan" });
    await waitFor(() => {
      expect(btn.querySelector("img")).toHaveAttribute(
        "src",
        "https://signed.example.com/legacy-1.png?token=abc"
      );
    });
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument();
  });

  it("menampilkan badge +N di tabel dan grid + navigasi lightbox saat ada banyak foto", async () => {
    const multiUrl = JSON.stringify([
      "https://proj.supabase.co/storage/v1/object/public/surat-jalan/sj-a.png",
      "https://proj.supabase.co/storage/v1/object/public/surat-jalan/sj-b.png",
      "https://proj.supabase.co/storage/v1/object/public/surat-jalan/sj-c.png",
    ]);

    const { rerender } = render(
      <ProofImage url={multiUrl} label="OUT-2026-000010" variant="thumb" />
    );

    expect(
      screen.getByRole("button", { name: "Lihat 3 foto surat jalan" })
    ).toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();

    rerender(<ProofImage url={multiUrl} label="OUT-2026-000010" variant="large" />);
    expect(screen.getByText("3 foto surat jalan terlampir")).toBeInTheDocument();

    const foto2Btn = screen.getByRole("button", {
      name: "Lihat foto surat jalan 2",
    });
    await waitFor(() => {
      expect(foto2Btn.querySelector("img")).toHaveAttribute(
        "src",
        "https://signed.example.com/sj-b.png?token=abc"
      );
    });

    fireEvent.click(foto2Btn);
    expect(screen.getByText("OUT-2026-000010 — Foto 2 dari 3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Foto berikutnya" }));
    expect(screen.getByText("OUT-2026-000010 — Foto 3 dari 3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Foto sebelumnya" }));
    expect(screen.getByText("OUT-2026-000010 — Foto 2 dari 3")).toBeInTheDocument();
  });
});
