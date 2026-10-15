import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RequestFormPage } from "../../pages/RequestFormPage";

type AnyFn = Record<string, unknown> & ((...args: unknown[]) => unknown);

function makeProxy(): AnyFn {
  const target = function () {} as unknown as AnyFn;
  return new Proxy(target, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) =>
          resolve({ data: [], error: null, count: 0, user: null, session: null });
      }
      if (prop === "catch" || prop === "finally") return undefined;
      return makeProxy();
    },
    apply() {
      return makeProxy();
    },
  });
}

vi.mock("../../context/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ supabase: makeProxy() }));

const { useAuth } = await import("../../context/AuthContext");
vi.mocked(useAuth).mockReturnValue({
  user: { id: "u-1", email: "admin@contoh.id" },
  profile: { id: "u-1", full_name: "Admin", role_id: "r", roles: { name: "admin" } },
  permissions: [],
  loading: false,
  isSuperAdmin: true,
  isStaff: true,
  hasPermission: () => true,
  signIn: vi.fn(),
  signOut: vi.fn(),
  refreshProfile: vi.fn(),
} as unknown as ReturnType<typeof useAuth>);

function renderForm() {
  return render(
    <MemoryRouter>
      <RequestFormPage />
    </MemoryRouter>
  );
}

function optionsOf(labelText: string): string[] {
  const label = screen.getByText(labelText);
  const select = label.parentElement?.querySelector("select") as HTMLSelectElement | null;
  expect(select).toBeTruthy();
  return Array.from(select!.options).map((o) => o.textContent ?? "");
}

describe("Dropdown Status Request & Status Asset", () => {
  it("Status Request hanya berisi Penambahan, Pergantian, Pinjam", () => {
    renderForm();
    expect(optionsOf("Status Request")).toEqual(["Penambahan", "Pergantian", "Pinjam"]);
  });

  it("Status Asset hanya berisi Asset Baru, Asset Return, Unready", () => {
    renderForm();
    expect(optionsOf("Status Asset")).toEqual(["Asset Baru", "Asset Return", "Unready"]);
  });

  it("kolom Durasi Pinjam hanya muncul saat Status Request = Pinjam", () => {
    renderForm();
    expect(screen.queryByText("Durasi Pinjam")).toBeNull();

    const label = screen.getByText("Status Request");
    const select = label.parentElement?.querySelector("select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "PINJAM" } });

    expect(screen.getByText("Durasi Pinjam")).toBeTruthy();
  });

  it("status asset menampilkan lokasi stok yang dipotong", () => {
    renderForm();
    expect(screen.getByText(/STOK-BARU/)).toBeTruthy();
  });
});
