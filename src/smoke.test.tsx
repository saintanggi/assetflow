import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ComponentType } from "react";

vi.mock("./context/AuthContext", () => ({ useAuth: vi.fn() }));

type AnyFn = Record<string, unknown> & ((...args: unknown[]) => unknown);

const supabaseMock = makeProxy();

export { supabaseMock };

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

vi.mock("html5-qrcode", () => ({ Html5Qrcode: class { constructor() {} start() { return Promise.resolve(); } stop() { return Promise.resolve(); } clear() {} static getCameras() { return Promise.resolve([]); } }, Html5QrcodeSupportedFormats: { QR_CODE: 0, CODE_128: 1 } }));
vi.mock("./hooks/useSupabaseQuery", () => ({ useSupabaseQuery: () => ({ data: [], loading: false, error: null, refetch: vi.fn() }) }));
vi.mock("./hooks/useLookupData", () => ({ useLookupData: () => ({ categories: [], warehouses: [], units: [], departments: [], suppliers: [] }) }));

const { useAuth } = await import("./context/AuthContext");
const mockUseAuth = vi.mocked(useAuth);

function setAuth() {
  mockUseAuth.mockReturnValue({
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
}

const pages: Record<string, { load: () => Promise<{ [k: string]: ComponentType }>; comp: string; path: string; entry?: string; props?: Record<string, unknown> }> = {
  AssetDetailPage: { load: () => import("./pages/AssetDetailPage"), comp: "AssetDetailPage", path: "/aset/:id" },
  AssetFormPage: { load: () => import("./pages/AssetFormPage"), comp: "AssetFormPage", path: "/aset/baru" },
  AssetListPage: { load: () => import("./pages/AssetListPage"), comp: "AssetListPage", path: "/aset" },
  AuditLogPage: { load: () => import("./pages/AuditLogPage"), comp: "AuditLogPage", path: "/audit" },
  CategoriesPage: { load: () => import("./pages/CategoriesPage"), comp: "CategoriesPage", path: "/master/kategori" },
  DashboardPage: { load: () => import("./pages/DashboardPage"), comp: "DashboardPage", path: "/dashboard" },
  DepartmentsPage: { load: () => import("./pages/DepartmentsPage"), comp: "DepartmentsPage", path: "/master/departemen" },
  ForbiddenPage: { load: () => import("./pages/ForbiddenPage"), comp: "ForbiddenPage", path: "/403" },
  ForgotPasswordPage: { load: () => import("./pages/ForgotPasswordPage"), comp: "ForgotPasswordPage", path: "/lupa-password" },
  InventoryDetailPage: { load: () => import("./pages/InventoryDetailPage"), comp: "InventoryDetailPage", path: "/persediaan/:id" },
  InventoryListPage: { load: () => import("./pages/InventoryListPage"), comp: "InventoryListPage", path: "/persediaan" },
  IssuePage: { load: () => import("./pages/IssuePage"), comp: "IssuePage", path: "/transaksi/keluar" },
  KartuStokPage: { load: () => import("./pages/KartuStokPage"), comp: "KartuStokPage", path: "/transaksi/kartu-stok" },
  LabelPrintPage: { load: () => import("./pages/LabelPrintPage"), comp: "LabelPrintPage", path: "/label" },
  LandingPage: { load: () => import("./pages/LandingPage"), comp: "LandingPage", path: "/" },
  LiveStockPage: { load: () => import("./pages/LiveStockPage"), comp: "LiveStockPage", path: "/laporan/live-stok" },
  LoginPage: { load: () => import("./pages/LoginPage"), comp: "LoginPage", path: "/login" },
  NotFoundPage: { load: () => import("./pages/NotFoundPage"), comp: "NotFoundPage", path: "/nope" },
  PendingPartialPage: { load: () => import("./pages/PendingPartialPage"), comp: "PendingPartialPage", path: "/permintaan/sisa" },
  PublicAssetDetailPage: { load: () => import("./pages/PublicAssetDetailPage"), comp: "PublicAssetDetailPage", path: "/publik/aset/:code" },
  PublicDashboardPage: { load: () => import("./pages/PublicDashboardPage"), comp: "PublicDashboardPage", path: "/publik" },
  ReceivePage: { load: () => import("./pages/ReceivePage"), comp: "ReceivePage", path: "/transaksi/masuk" },
  ReportsPage: { load: () => import("./pages/ReportsPage"), comp: "ReportsPage", path: "/laporan" },
  RequestDetailPage: { load: () => import("./pages/RequestDetailPage"), comp: "RequestDetailPage", path: "/permintaan/:id" },
  RequestFormPage: { load: () => import("./pages/RequestFormPage"), comp: "RequestFormPage", path: "/permintaan/baru" },
  RequestListPage: { load: () => import("./pages/RequestListPage"), comp: "RequestListPage", path: "/permintaan" },
  RequestUploadPage: { load: () => import("./pages/RequestUploadPage"), comp: "RequestUploadPage", path: "/permintaan/upload" },
  ResetPasswordPage: { load: () => import("./pages/ResetPasswordPage"), comp: "ResetPasswordPage", path: "/reset-password" },
  RolesPage: { load: () => import("./pages/RolesPage"), comp: "RolesPage", path: "/peran" },
  ScannerPage: { load: () => import("./pages/ScannerPage"), comp: "ScannerPage", path: "/pindai" },
  SettingsPage: { load: () => import("./pages/SettingsPage"), comp: "SettingsPage", path: "/pengaturan" },
  StockAlertsPage: { load: () => import("./pages/StockAlertsPage"), comp: "StockAlertsPage", path: "/persediaan/peringatan-stok" },
  StockOpnamePage: { load: () => import("./pages/StockOpnamePage"), comp: "StockOpnamePage", path: "/transaksi/opname" },
  StokKondisiPage: { load: () => import("./pages/StokKondisiPage"), comp: "StokKondisiPage", path: "/persediaan/kondisi", props: { kondisi: "baru" } } as never,
  SuperAdminDashboardPage: { load: () => import("./pages/SuperAdminDashboardPage"), comp: "SuperAdminDashboardPage", path: "/admin" },
  SuppliersPage: { load: () => import("./pages/SuppliersPage"), comp: "SuppliersPage", path: "/master/pemasok" },
  TransactionHistoryPage: { load: () => import("./pages/TransactionHistoryPage"), comp: "TransactionHistoryPage", path: "/transaksi/riwayat" },
  TransactionLogPage: { load: () => import("./pages/TransactionLogPage"), comp: "TransactionLogPage", path: "/transaksi/log" },
  TransferPage: { load: () => import("./pages/TransferPage"), comp: "TransferPage", path: "/transaksi/transfer" },
  UnitsPage: { load: () => import("./pages/UnitsPage"), comp: "UnitsPage", path: "/master/satuan" },
  UserManagementPage: { load: () => import("./pages/UserManagementPage"), comp: "UserManagementPage", path: "/pengaturan/akun" },
  UsersPage: { load: () => import("./pages/UsersPage"), comp: "UsersPage", path: "/pengguna" },
  WarehousesPage: { load: () => import("./pages/WarehousesPage"), comp: "WarehousesPage", path: "/master/gudang" },
};

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  setAuth();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const LEGACY = [
  /\bslate-/, /\bink-9\d\d/, /\bink-8[5-9]\d/, /\bbrand-[34]\d\d/,
  /\brose-/, /\bamber-/, /\bsky-/, /\bviolet-/, /\bemerald-/, /\bteal-/, /\blime-/, /\bcyan-/, /\bindigo-/,
  /shadow-glow/, /from-brand/, /via-brand/, /to-brand-\d/,
];

function findLegacyClasses(root: HTMLElement): string[] {
  const found: string[] = [];
  root.querySelectorAll("*").forEach((el) => {
    const cls = el.getAttribute("class") ?? "";
    if (LEGACY.some((re) => re.test(cls))) found.push(cls);
  });
  return found;
}

describe("smoke render semua halaman", () => {
  for (const [name, cfg] of Object.entries(pages)) {
    it(`${name} dapat dirender`, async () => {
      const mod = await cfg.load();
      const Comp = mod[cfg.comp];
      expect(Comp).toBeTruthy();
      const { container, unmount } = render(
        <MemoryRouter initialEntries={[cfg.entry ?? cfg.path]}>
          <Routes>
            <Route path={cfg.path} element={<Comp {...(cfg.props ?? {})} />} />
          </Routes>
        </MemoryRouter>
      );
      const bad = findLegacyClasses(container as unknown as HTMLElement);
      const calls = errorSpy.mock.calls.map((c) => String(c[0])).join(" | ");
      unmount();
      expect(calls).not.toContain("Uncaught");
      expect(bad).toEqual([]);
    });
  }
});
