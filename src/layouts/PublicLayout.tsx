import { Link, Outlet } from "react-router-dom";
import { Toaster } from "sonner";

export function PublicLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-ink-50">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 shadow-soft">
              <span className="font-display text-sm font-extrabold text-white">IW</span>
            </div>
            <span className="font-display text-lg font-bold text-ink-800">Inventory Warehouse</span>
          </Link>
          <nav className="flex items-center gap-2 sm:gap-4">
            <Link to="/publik" className="text-sm font-medium text-ink-500 hover:text-brand-700">
              Katalog Publik
            </Link>
            <Link
              to="/login"
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-soft transition-all hover:bg-brand-700"
            >
              Masuk
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-ink-200 bg-white py-6">
        <div className="mx-auto max-w-7xl px-4 text-center text-sm text-ink-500">
          © {new Date().getFullYear()} Inventory Warehouse — Sistem Informasi Manajemen Aset & Gudang
        </div>
      </footer>
      <Toaster richColors position="top-right" />
    </div>
  );
}
