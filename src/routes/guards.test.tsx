import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { RequireAuth, RequirePermission, RequireSuperAdmin } from "./guards";
import { useAuth } from "../context/AuthContext";

vi.mock("../context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

const mockUseAuth = vi.mocked(useAuth);

function setAuth(overrides: Partial<ReturnType<typeof useAuth>> = {}) {
  mockUseAuth.mockReturnValue({
    user: null,
    profile: null,
    permissions: [],
    loading: false,
    isSuperAdmin: false,
    isStaff: false,
    hasPermission: () => false,
    signIn: vi.fn(),
    signOut: vi.fn(),
    refreshProfile: vi.fn(),
    ...overrides,
  });
}

const staffUser = { id: "u-1", email: "admin@contoh.id" } as ReturnType<typeof useAuth>["user"];

function renderWithRoutes(ui: React.ReactNode, initialPath = "/rahasia") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/rahasia" element={ui} />
        <Route path="/login" element={<p>Halaman Login</p>} />
        <Route path="/403" element={<p>Akses Ditolak</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("RequireAuth", () => {
  beforeEach(() => vi.clearAllMocks());

  it("mengalihkan ke /login bila belum login", () => {
    setAuth({ user: null });
    renderWithRoutes(<RequireAuth><p>Konten Rahasia</p></RequireAuth>);
    expect(screen.getByText("Halaman Login")).toBeInTheDocument();
    expect(screen.queryByText("Konten Rahasia")).not.toBeInTheDocument();
  });

  it("menampilkan konten bila sudah login", () => {
    setAuth({ user: staffUser });
    renderWithRoutes(<RequireAuth><p>Konten Rahasia</p></RequireAuth>);
    expect(screen.getByText("Konten Rahasia")).toBeInTheDocument();
  });
});

describe("RequirePermission", () => {
  beforeEach(() => vi.clearAllMocks());

  it("mengalihkan ke /403 bila permission tidak dimiliki", () => {
    setAuth({ user: staffUser, hasPermission: () => false });
    renderWithRoutes(
      <RequirePermission code="assets.view"><p>Daftar Aset</p></RequirePermission>
    );
    expect(screen.getByText("Akses Ditolak")).toBeInTheDocument();
  });

  it("menampilkan konten bila permission dimiliki", () => {
    setAuth({ user: staffUser, hasPermission: (c: string) => c === "assets.view" });
    renderWithRoutes(
      <RequirePermission code="assets.view"><p>Daftar Aset</p></RequirePermission>
    );
    expect(screen.getByText("Daftar Aset")).toBeInTheDocument();
  });
});

describe("RequireSuperAdmin", () => {
  beforeEach(() => vi.clearAllMocks());

  it("mengalihkan ke /403 untuk admin biasa", () => {
    setAuth({ user: staffUser, isSuperAdmin: false });
    renderWithRoutes(<RequireSuperAdmin><p>Panel Super</p></RequireSuperAdmin>);
    expect(screen.getByText("Akses Ditolak")).toBeInTheDocument();
  });

  it("menampilkan konten untuk super admin", () => {
    setAuth({ user: staffUser, isSuperAdmin: true });
    renderWithRoutes(<RequireSuperAdmin><p>Panel Super</p></RequireSuperAdmin>);
    expect(screen.getByText("Panel Super")).toBeInTheDocument();
  });
});
