import { Link } from "react-router-dom";

/** Header kaca gelap untuk halaman publik (di luar shell aplikasi). */
export function PublicHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-ink-800/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4">
        <Link to="/publik" className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 shadow-soft">
            <span className="font-display text-sm font-extrabold tracking-tight text-white">
              IW
            </span>
          </div>
          <div className="min-w-0">
            <p className="truncate font-display text-[15px] font-bold leading-tight text-white">
              Inventory Warehouse
            </p>
            <p className="text-xs uppercase tracking-widest text-ink-300">
              Katalog Aset Publik
            </p>
          </div>
        </Link>
        <Link
          to="/login"
          className="ml-auto rounded-lg px-3 py-2 text-sm text-ink-300 transition-colors hover:bg-white/10 hover:text-white"
        >
          Masuk staf
        </Link>
      </div>
    </header>
  );
}
