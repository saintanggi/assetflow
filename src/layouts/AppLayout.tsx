import { useState } from "react";
import type { ReactNode } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  Boxes,
  Bell,
  ClipboardCheck,
  FileText,
  Layers,
  LogOut,
  Menu,
  Package,
  Printer,
  ScanLine,
  Settings,
  ShieldCheck,
  Users,
  Warehouse,
  X,
  ChevronDown,
  LayoutDashboard,
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowLeftRight,
  History,
  Tag,
  Ruler,
  Building2,
  Truck,
  KeyRound,
  ScrollText,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { cn } from "../lib/utils";
import { Button } from "../components/ui/button";
import { Toaster } from "sonner";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  permission?: string;
  superAdminOnly?: boolean;
  children?: NavItem[];
}

const NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  {
    to: "/aset",
    label: "Aset Tetap",
    icon: Package,
    permission: "assets.view",
  },
  {
    to: "/persediaan",
    label: "Persediaan",
    icon: Boxes,
    permission: "inventory.view",
  },
  {
    to: "#transaksi",
    label: "Transaksi",
    icon: ArrowLeftRight,
    children: [
      { to: "/transaksi/masuk", label: "Barang Masuk", icon: ArrowDownToLine, permission: "inventory.receive" },
      { to: "/transaksi/keluar", label: "Barang Keluar", icon: ArrowUpFromLine, permission: "inventory.issue" },
      { to: "/transaksi/transfer", label: "Transfer Stok", icon: ArrowLeftRight, permission: "inventory.transfer" },
      { to: "/transaksi/opname", label: "Stock Opname", icon: ClipboardCheck, permission: "inventory.adjust" },
      { to: "/transaksi/riwayat", label: "Riwayat Transaksi", icon: History, permission: "inventory.view" },
    ],
  },
  { to: "/pindai", label: "Pindai Kode", icon: ScanLine },
  { to: "/label", label: "Cetak Label", icon: Printer, permission: "labels.print" },
  { to: "/laporan", label: "Laporan", icon: FileText, permission: "reports.view" },
  {
    to: "#master",
    label: "Master Data",
    icon: Layers,
    permission: "settings.manage",
    children: [
      { to: "/master/kategori", label: "Kategori", icon: Tag, permission: "settings.manage" },
      { to: "/master/gudang", label: "Gudang & Lokasi", icon: Warehouse, permission: "settings.manage" },
      { to: "/master/satuan", label: "Satuan", icon: Ruler, permission: "settings.manage" },
      { to: "/master/departemen", label: "Departemen", icon: Building2, permission: "settings.manage" },
      { to: "/master/pemasok", label: "Pemasok", icon: Truck, permission: "settings.manage" },
    ],
  },
  { to: "/pengguna", label: "Pengguna", icon: Users, permission: "users.manage" },
  { to: "/peran", label: "Peran & Izin", icon: KeyRound, superAdminOnly: true },
  { to: "/audit", label: "Audit Log", icon: ScrollText, permission: "audit.view" },
  { to: "/pengaturan", label: "Pengaturan", icon: Settings, permission: "settings.manage" },
  { to: "/admin", label: "Panel Super Admin", icon: ShieldCheck, superAdminOnly: true },
];

function isVisible(item: NavItem, hasPermission: (c: string) => boolean, isSuperAdmin: boolean): boolean {
  if (item.superAdminOnly && !isSuperAdmin) return false;
  if (item.children) return item.children.some((c) => isVisible(c, hasPermission, isSuperAdmin));
  if (item.permission && !hasPermission(item.permission)) return false;
  return true;
}

function NavEntry({
  item,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  onNavigate: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (item.children) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-400 transition-colors hover:bg-white/5 hover:text-white",
            collapsed && "justify-center px-2"
          )}
          title={collapsed ? item.label : undefined}
        >
          <item.icon className="h-5 w-5 shrink-0" />
          {!collapsed && <span className="flex-1 text-left">{item.label}</span>}
          {!collapsed && (
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
          )}
        </button>
        {open && !collapsed && (
          <div className="ml-6 mt-1 space-y-1 border-l border-white/10 pl-2">
            {item.children.map((c) => (
              <NavLink
                key={c.to}
                to={c.to}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-400 transition-colors hover:bg-white/5 hover:text-white",
                    isActive && "bg-brand-400/10 text-brand-300"
                  )
                }
              >
                <c.icon className="h-4 w-4 shrink-0" />
                {c.label}
              </NavLink>
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-400 transition-colors hover:bg-white/5 hover:text-white",
          isActive && "bg-brand-400/10 text-brand-300 hover:bg-brand-400/10 hover:text-brand-300",
          collapsed && "justify-center px-2"
        )
      }
      title={collapsed ? item.label : undefined}
    >
      {({ isActive }) =>
        isActive ? (
          <>
            <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-brand-400" />
            <item.icon className="h-5 w-5 shrink-0" />
            {!collapsed && <span>{item.label}</span>}
          </>
        ) : (
          <>
            <item.icon className="h-5 w-5 shrink-0" />
            {!collapsed && <span>{item.label}</span>}
          </>
        )
      }
    </NavLink>
  );
}

function SidebarContent({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate: () => void;
}) {
  const { hasPermission, isSuperAdmin, profile, user, signOut } = useAuth();
  const navigate = useNavigate();
  const items = NAV.filter((i) => isVisible(i, hasPermission, isSuperAdmin));

  return (
    <div className="flex h-full flex-col">
      <Link
        to="/dashboard"
        onClick={onNavigate}
        className={cn(
          "flex items-center gap-3 border-b border-white/5 px-4 py-5",
          collapsed && "justify-center px-2"
        )}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 shadow-glow">
          <span className="font-display text-sm font-extrabold tracking-tight text-ink-950">
            IW
          </span>
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate font-display text-[15px] font-bold leading-tight text-white">
              Inventory Warehouse
            </p>
            <p className="text-[11px] uppercase tracking-widest text-brand-400/80">
              Command Center
            </p>
          </div>
        )}
      </Link>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {items.map((item) => (
          <NavEntry key={item.to + item.label} item={item} collapsed={collapsed} onNavigate={onNavigate} />
        ))}
      </nav>

      <div className="border-t border-white/5 p-3">
        {!collapsed && (
          <div className="mb-2 flex items-center gap-2.5 px-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-400" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">
                {profile?.full_name ?? user?.email}
              </p>
              <p className="truncate text-xs text-slate-500">
                {isSuperAdmin ? "Super Admin" : "Admin"} • Online
              </p>
            </div>
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-slate-400 hover:bg-white/5 hover:text-white"
          onClick={async () => {
            await signOut();
            navigate("/login");
          }}
        >
          <LogOut className="h-4 w-4" />
          {!collapsed && <span className="ml-2">Keluar</span>}
        </Button>
      </div>
    </div>
  );
}

function GlobalSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  return (
    <form
      className="relative hidden w-72 md:block"
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim()) navigate(`/aset?q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Cari aset, SKU, transaksi…"
        className="h-9 w-full rounded-lg border border-white/10 bg-white/5 pl-9 pr-16 text-sm text-slate-200 placeholder:text-slate-500 focus:border-brand-400/50 focus:outline-none focus:ring-2 focus:ring-brand-400/20"
      />
      <svg viewBox="0 0 24 24" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-slate-500 lg:inline-flex">
        Ctrl K
      </kbd>
    </form>
  );
}

export function AppLayout(): ReactNode {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { profile, user, isSuperAdmin } = useAuth();

  return (
    <div className="flex min-h-screen bg-ink-950">
      {/* Sidebar desktop */}
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 border-r border-white/5 bg-ink-900 transition-all duration-200 lg:block",
          collapsed ? "w-20" : "w-64"
        )}
      >
        <SidebarContent collapsed={collapsed} onNavigate={() => {}} />
      </aside>

      {/* Sidebar mobile */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-72 border-r border-white/5 bg-ink-900">
            <button
              type="button"
              aria-label="Tutup menu"
              className="absolute right-3 top-5 text-slate-400 hover:text-white"
              onClick={() => setMobileOpen(false)}
            >
              <X className="h-5 w-5" />
            </button>
            <SidebarContent collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-white/5 bg-ink-950/85 px-4 backdrop-blur-xl">
          <button
            type="button"
            aria-label="Menu"
            className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white lg:hidden"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Ciutkan sidebar"
            className="hidden rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white lg:block"
            onClick={() => setCollapsed((v) => !v)}
          >
            <Menu className="h-5 w-5" />
          </button>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-2">
            <Link
              to="/publik"
              target="_blank"
              className="hidden rounded-lg px-3 py-2 text-sm text-slate-400 transition-colors hover:bg-white/5 hover:text-brand-300 sm:block"
            >
              Lihat situs publik
            </Link>
            <button
              type="button"
              aria-label="Notifikasi"
              className="relative rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
            >
              <Bell className="h-5 w-5" />
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-ink-950" />
            </button>
            <div className="mx-1 hidden h-8 w-px bg-white/10 sm:block" />
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-sm font-bold text-ink-950 ring-2 ring-brand-400/20">
              {(profile?.full_name ?? user?.email ?? "?").charAt(0).toUpperCase()}
            </div>
            <div className="hidden sm:block">
              <p className="max-w-40 truncate text-sm font-medium text-white">
                {profile?.full_name ?? user?.email}
              </p>
              <p className="text-xs text-slate-500">{isSuperAdmin ? "Super Admin" : "Admin"}</p>
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6">
          <div className="mx-auto max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
      <Toaster richColors position="top-right" />
    </div>
  );
}
