import { Link, Outlet } from "react-router-dom";
import { Toaster } from "sonner";

export function PublicLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-ink-950">
      <header className="border-b border-white/10 bg-ink-850">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 shadow-glow">
              <span className="font-display text-sm font-extrabold text-ink-950">IW</span>
            </div>
            <span className="font-display text-lg font-bold text-white">Inventory Warehouse</span>
          </Link>
          <nav className="flex items-center gap-2 sm:gap-4">
            <Link to="/publik" className="text-sm font-medium text-slate-400 hover:text-brand-300">
              Katalog Publik
            </Link>
            <Link
              to="/login"
              className="rounded-lg bg-gradient-to-r from-brand-400 to-brand-500 px-4 py-2 text-sm font-semibold text-ink-950 shadow-glow transition-all hover:brightness-110"
            >
              Masuk
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-white/10 bg-ink-850 py-6">
        <div className="mx-auto max-w-7xl px-4 text-center text-sm text-slate-500">
          © {new Date().getFullYear()} Inventory Warehouse — Sistem Informasi Manajemen Aset & Gudang
        </div>
      </footer>
      <Toaster richColors position="top-right" />
    </div>
  );
}
