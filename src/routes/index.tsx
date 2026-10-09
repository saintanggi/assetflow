import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppLayout } from "../layouts/AppLayout";
import { PublicLayout } from "../layouts/PublicLayout";
import { RequireAuth, RequirePermission, RequireSuperAdmin } from "./guards";

import { LandingPage } from "../pages/LandingPage";
import { LoginPage } from "../pages/LoginPage";
import { ForgotPasswordPage } from "../pages/ForgotPasswordPage";
import { ResetPasswordPage } from "../pages/ResetPasswordPage";
import { PublicDashboardPage } from "../pages/PublicDashboardPage";
import { PublicAssetDetailPage } from "../pages/PublicAssetDetailPage";
import { DashboardPage } from "../pages/DashboardPage";
import { SuperAdminDashboardPage } from "../pages/SuperAdminDashboardPage";
import { AssetListPage } from "../pages/AssetListPage";
import { AssetDetailPage } from "../pages/AssetDetailPage";
import { AssetFormPage } from "../pages/AssetFormPage";
import { InventoryListPage } from "../pages/InventoryListPage";
import { InventoryDetailPage } from "../pages/InventoryDetailPage";
import { ReceivePage } from "../pages/ReceivePage";
import { IssuePage } from "../pages/IssuePage";
import { TransferPage } from "../pages/TransferPage";
import { StockOpnamePage } from "../pages/StockOpnamePage";
import { TransactionHistoryPage } from "../pages/TransactionHistoryPage";
import { ScannerPage } from "../pages/ScannerPage";
import { LabelPrintPage } from "../pages/LabelPrintPage";
import { CategoriesPage } from "../pages/CategoriesPage";
import { WarehousesPage } from "../pages/WarehousesPage";
import { UnitsPage } from "../pages/UnitsPage";
import { DepartmentsPage } from "../pages/DepartmentsPage";
import { SuppliersPage } from "../pages/SuppliersPage";
import { UsersPage } from "../pages/UsersPage";
import { RolesPage } from "../pages/RolesPage";
import { ReportsPage } from "../pages/ReportsPage";
import { AuditLogPage } from "../pages/AuditLogPage";
import { SettingsPage } from "../pages/SettingsPage";
import { ForbiddenPage } from "../pages/ForbiddenPage";
import { NotFoundPage } from "../pages/NotFoundPage";

export const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    children: [
      { path: "/", element: <LandingPage /> },
      { path: "/login", element: <LoginPage /> },
      { path: "/lupa-password", element: <ForgotPasswordPage /> },
      { path: "/reset-password", element: <ResetPasswordPage /> },
      { path: "/publik", element: <PublicDashboardPage /> },
      { path: "/publik/aset/:publicCode", element: <PublicAssetDetailPage /> },
      { path: "/403", element: <ForbiddenPage /> },
    ],
  },
  {
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { path: "/dashboard", element: <DashboardPage /> },
      {
        path: "/admin",
        element: (
          <RequireSuperAdmin>
            <SuperAdminDashboardPage />
          </RequireSuperAdmin>
        ),
      },
      {
        path: "/aset",
        element: (
          <RequirePermission code="assets.view">
            <AssetListPage />
          </RequirePermission>
        ),
      },
      {
        path: "/aset/tambah",
        element: (
          <RequirePermission code="assets.create">
            <AssetFormPage />
          </RequirePermission>
        ),
      },
      {
        path: "/aset/:id",
        element: (
          <RequirePermission code="assets.view">
            <AssetDetailPage />
          </RequirePermission>
        ),
      },
      {
        path: "/aset/:id/ubah",
        element: (
          <RequirePermission code="assets.update">
            <AssetFormPage />
          </RequirePermission>
        ),
      },
      {
        path: "/persediaan",
        element: (
          <RequirePermission code="inventory.view">
            <InventoryListPage />
          </RequirePermission>
        ),
      },
      {
        path: "/persediaan/:id",
        element: (
          <RequirePermission code="inventory.view">
            <InventoryDetailPage />
          </RequirePermission>
        ),
      },
      {
        path: "/transaksi/masuk",
        element: (
          <RequirePermission code="inventory.receive">
            <ReceivePage />
          </RequirePermission>
        ),
      },
      {
        path: "/transaksi/keluar",
        element: (
          <RequirePermission code="inventory.issue">
            <IssuePage />
          </RequirePermission>
        ),
      },
      {
        path: "/transaksi/transfer",
        element: (
          <RequirePermission code="inventory.transfer">
            <TransferPage />
          </RequirePermission>
        ),
      },
      {
        path: "/transaksi/opname",
        element: (
          <RequirePermission code="inventory.adjust">
            <StockOpnamePage />
          </RequirePermission>
        ),
      },
      {
        path: "/transaksi/riwayat",
        element: (
          <RequirePermission code="inventory.view">
            <TransactionHistoryPage />
          </RequirePermission>
        ),
      },
      { path: "/pindai", element: <ScannerPage /> },
      {
        path: "/label",
        element: (
          <RequirePermission code="labels.print">
            <LabelPrintPage />
          </RequirePermission>
        ),
      },
      {
        path: "/master/kategori",
        element: (
          <RequirePermission code="settings.manage">
            <CategoriesPage />
          </RequirePermission>
        ),
      },
      {
        path: "/master/gudang",
        element: (
          <RequirePermission code="settings.manage">
            <WarehousesPage />
          </RequirePermission>
        ),
      },
      {
        path: "/master/satuan",
        element: (
          <RequirePermission code="settings.manage">
            <UnitsPage />
          </RequirePermission>
        ),
      },
      {
        path: "/master/departemen",
        element: (
          <RequirePermission code="settings.manage">
            <DepartmentsPage />
          </RequirePermission>
        ),
      },
      {
        path: "/master/pemasok",
        element: (
          <RequirePermission code="settings.manage">
            <SuppliersPage />
          </RequirePermission>
        ),
      },
      {
        path: "/pengguna",
        element: (
          <RequirePermission code="users.manage">
            <UsersPage />
          </RequirePermission>
        ),
      },
      {
        path: "/peran",
        element: (
          <RequireSuperAdmin>
            <RolesPage />
          </RequireSuperAdmin>
        ),
      },
      {
        path: "/laporan",
        element: (
          <RequirePermission code="reports.view">
            <ReportsPage />
          </RequirePermission>
        ),
      },
      {
        path: "/audit",
        element: (
          <RequirePermission code="audit.view">
            <AuditLogPage />
          </RequirePermission>
        ),
      },
      {
        path: "/pengaturan",
        element: (
          <RequirePermission code="settings.manage">
            <SettingsPage />
          </RequirePermission>
        ),
      },
      { path: "/403", element: <ForbiddenPage /> },
    ],
  },
  { path: "*", element: <NotFoundPage /> },
  { path: "/index.html", element: <Navigate to="/" replace /> },
]);
