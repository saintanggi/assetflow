import { Link, Outlet } from "react-router-dom";
import { ClipboardList } from "lucide-react";
import { Toaster } from "sonner";

export function PublicLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-navy-900">
              <ClipboardList className="h-5 w-5 text-white" />
            </div>
            <span className="text-lg font-bold text-navy-900">AssetFlow</span>
          </Link>
          <nav className="flex items-center gap-2 sm:gap-4">
            <Link to="/publik" className="text-sm font-medium text-slate-600 hover:text-brand-600">
              Katalog Publik
            </Link>
            <Link
              to="/login"
              className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800"
            >
              Masuk
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 bg-white py-6">
        <div className="mx-auto max-w-7xl px-4 text-center text-sm text-slate-500">
          © {new Date().getFullYear()} AssetFlow — Sistem Informasi Manajemen Aset & Gudang
        </div>
      </footer>
      <Toaster richColors position="top-right" />
    </div>
  );
}
