import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  Boxes,
  Bell,
  ClipboardCheck,
  FileText,
  Layers,
  LogOut,
  Menu,
  Package,
  PackageCheck,
  PackageOpen,
  PackageX,
  ShoppingCart,
  Printer,
  ScanLine,
  Settings,
  ShieldCheck,
  Users,
  Volume2,
  VolumeX,
  Warehouse,
  X,
  ChevronDown,
  ChevronRight,
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
  ClipboardList,
  Activity,
  Siren,
  Clock,
  Inbox,
  Hourglass,
  FileUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import {
  isNavSoundEnabled,
  playNavSound,
  setNavSoundEnabled,
  unlockAudio,
} from "../lib/sound";
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
    to: "#persediaan",
    label: "Persediaan",
    icon: Boxes,
    children: [
      { to: "/persediaan/baru", label: "Asset Baru", icon: PackageCheck, permission: "inventory.view" },
      { to: "/persediaan/return", label: "Asset Return", icon: PackageOpen, permission: "inventory.view" },
      { to: "/persediaan/unready", label: "Asset Unready", icon: PackageX, permission: "inventory.view" },
      { to: "/persediaan", label: "Master Barang", icon: Boxes, permission: "inventory.view" },
      { to: "/persediaan/peringatan-stok", label: "Peringatan Stok", icon: Siren, permission: "inventory.view" },
      { to: "/persediaan/dead-stock", label: "Dead Stock", icon: Clock, permission: "inventory.view" },
    ],
  },
  {
    to: "/permintaan",
    label: "Permintaan",
    icon: Inbox,
    permission: "requests.view",
  },
  {
    to: "/permintaan/sisa",
    label: "Sisa Belum Terkirim",
    icon: Hourglass,
    permission: "requests.view",
  },
  {
    to: "/permintaan/upload",
    label: "Upload Dokumen",
    icon: FileUp,
    permission: "requests.create",
  },
  {
    to: "/pembelian",
    label: "Pembelian (PO)",
    icon: ShoppingCart,
    permission: "inventory.receive",
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
      { to: "/transaksi/kartu-stok", label: "Input Kartu Stok", icon: ClipboardList, permission: "inventory.receive" },
      { to: "/transaksi/riwayat", label: "Riwayat Transaksi", icon: History, permission: "inventory.view" },
      { to: "/transaksi/log", label: "Log Transaksi", icon: ScrollText, permission: "inventory.view" },
    ],
  },
  { to: "/pindai", label: "Pindai Kode", icon: ScanLine },
  { to: "/label", label: "Cetak Label", icon: Printer, permission: "labels.print" },
  { to: "/laporan/live-stok", label: "Live Stok", icon: Activity, permission: "reports.view" },
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
  { to: "/pengaturan/akun", label: "Kelola Akun", icon: Users, permission: "users.manage" },
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
  badgeCount,
}: {
  item: NavItem;
  collapsed: boolean;
  onNavigate: () => void;
  badgeCount?: number;
}) {
  const [open, setOpen] = useState(false);
  if (item.children) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-ink-200 transition-colors hover:bg-white/10 hover:text-white",
            collapsed && "justify-center px-2"
          )}
          title={collapsed ? item.label : undefined}
        >
          <item.icon className="h-[18px] w-[18px] shrink-0" />
          {!collapsed && <span className="flex-1 text-left">{item.label}</span>}
          {!collapsed && (
            <ChevronDown className={cn("h-4 w-4 text-ink-300 transition-transform", open && "rotate-180")} />
          )}
        </button>
        {open && !collapsed && (
          <div className="ml-5 mt-1 space-y-0.5 border-l border-white/10 pl-2">
            {item.children.map((c) => (
              <NavLink
                key={c.to}
                to={c.to}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink-300 transition-colors hover:bg-white/10 hover:text-white",
                    isActive && "bg-brand-600/25 font-medium text-white hover:bg-brand-600/25 hover:text-white"
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
          "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-ink-200 transition-colors hover:bg-white/10 hover:text-white",
          isActive && "bg-brand-600/25 text-white hover:bg-brand-600/25 hover:text-white",
          collapsed && "justify-center px-2"
        )
      }
      title={collapsed ? item.label : undefined}
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-600" />
          )}
          <item.icon className="h-[18px] w-[18px] shrink-0" />
          {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
          {!collapsed && badgeCount !== undefined && badgeCount > 0 && (
            <span className="tnum rounded-full bg-brand-600 px-2 py-0.5 text-xs font-semibold text-white">
              {badgeCount > 99 ? "99+" : badgeCount}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

const ROLE_DISPLAY_NAMES: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  admin_ho: "Admin HO",
  admin_gudang: "Admin Gudang",
  helper: "Helper Gudang",
};

function getRoleLabel(roleName: string | undefined, isSuperAdmin: boolean): string {
  if (isSuperAdmin) return "Super Admin";
  if (roleName && ROLE_DISPLAY_NAMES[roleName]) return ROLE_DISPLAY_NAMES[roleName];
  return "Admin";
}

const BREADCRUMB_EXTRA: { prefix: string; group: string; label: string }[] = [
  { prefix: "/aset/tambah", group: "Aset Tetap", label: "Tambah Aset" },
  { prefix: "/aset/", group: "Aset Tetap", label: "Detail Aset" },
  { prefix: "/persediaan/baru", group: "Persediaan", label: "Asset Baru" },
  { prefix: "/persediaan/return", group: "Persediaan", label: "Asset Return" },
  { prefix: "/persediaan/unready", group: "Persediaan", label: "Asset Unready" },
  { prefix: "/persediaan/peringatan-stok", group: "Persediaan", label: "Peringatan Stok" },
  { prefix: "/permintaan/baru", group: "Permintaan", label: "Buat Permintaan" },
  { prefix: "/permintaan/upload", group: "Permintaan", label: "Upload Dokumen" },
  { prefix: "/permintaan/sisa", group: "Permintaan", label: "Sisa Belum Terkirim" },
  { prefix: "/pengaturan/akun", group: "Pengaturan", label: "Kelola Akun" },
  { prefix: "/laporan/live-stok", group: "Laporan", label: "Live Stok" },
];

function buildCrumbs(pathname: string): string[] {
  const items = NAV.flatMap((i) =>
    i.children ? i.children.map((c) => ({ to: c.to, label: c.label, group: i.label })) : [{ to: i.to, label: i.label }]
  );
  let best: { to: string; label: string; group?: string } | null = null;
  for (const it of items) {
    if (it.to.startsWith("#")) continue;
    if (pathname === it.to || pathname.startsWith(it.to + "/")) {
      if (!best || it.to.length > best.to.length) best = it;
    }
  }
  const extra = BREADCRUMB_EXTRA.filter((e) => pathname.startsWith(e.prefix)).sort(
    (a, b) => b.prefix.length - a.prefix.length
  )[0];
  if (extra) return [extra.group, extra.label];
  if (!best) return [];
  return best.group ? [best.group, best.label] : [best.label];
}

function SidebarContent({
  collapsed,
  onNavigate,
  badges,
}: {
  collapsed: boolean;
  onNavigate: () => void;
  badges: Record<string, number>;
}) {
  const { hasPermission, isSuperAdmin, profile, user, signOut } = useAuth();
  const navigate = useNavigate();
  const items = NAV.filter((i) => isVisible(i, hasPermission, isSuperAdmin));
  const roleLabel = getRoleLabel(profile?.roles?.name, isSuperAdmin);
  const displayName =
    profile?.full_name ??
    (profile as unknown as { display_name?: string } | null)?.display_name ??
    user?.email;

  return (
    <div className="flex h-full flex-col">
      <Link
        to="/dashboard"
        onClick={onNavigate}
        className={cn(
          "flex items-center gap-3 border-b border-white/10 px-4 py-[18px]",
          collapsed && "justify-center px-2"
        )}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 shadow-soft">
          <span className="font-display text-sm font-extrabold tracking-tight text-white">
            IW
          </span>
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate font-display text-[15px] font-bold leading-tight text-white">
              Inventory Warehouse
            </p>
            <p className="text-xs uppercase tracking-widest text-ink-300">
              Command Center
            </p>
          </div>
        )}
      </Link>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {items.map((item) => (
          <NavEntry
            key={item.to + item.label}
            item={item}
            collapsed={collapsed}
            onNavigate={onNavigate}
            badgeCount={badges[item.to]}
          />
        ))}
      </nav>

      <div className="border-t border-white/10 p-3">
        {!collapsed && (
          <div className="mb-2 flex items-center gap-2.5 px-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok-500 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-ok-500" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">
                {displayName}
              </p>
              <p className="truncate text-xs text-ink-300">
                {roleLabel} • Online
              </p>
            </div>
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-ink-200 hover:bg-white/10 hover:text-white"
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
  const { hasPermission } = useAuth();
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <form
      className="relative hidden w-72 md:block"
      onSubmit={(e) => {
        e.preventDefault();
        const term = q.trim();
        if (!term) return;
        if (hasPermission("assets.view")) {
          navigate(`/aset?q=${encodeURIComponent(term)}`);
        } else if (hasPermission("inventory.view")) {
          navigate("/persediaan");
        } else {
          navigate("/permintaan");
        }
      }}
    >
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Cari barang, permintaan, SKU…"
        className="h-9 w-full rounded-lg border border-white/15 bg-white/10 pl-9 pr-16 text-sm text-white placeholder:text-ink-300 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25"
      />
      <svg viewBox="0 0 24 24" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-300" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded border border-white/15 bg-white/10 px-1.5 py-0.5 font-mono text-xs text-ink-300 lg:inline-flex">
        Ctrl K
      </kbd>
    </form>
  );
}

interface BottomNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  permission?: string;
  badge?: number;
  active: (pathname: string, tab: string | null) => boolean;
}

/**
 * Navigasi bawah khusus HP (tampil < lg) — menu utama yang paling sering
 * dipakai staf gudang sambil jalan, dalam jangkauan jempol. "Kirim" membuka
 * daftar permintaan aktif (tab Aktif) supaya langsung ke antrean kirim.
 */
function BottomNav({
  permintaanBadge,
  sisaBadge,
}: {
  permintaanBadge: number;
  sisaBadge: number;
}) {
  const { hasPermission } = useAuth();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const tab = searchParams.get("tab");
  const pathname = location.pathname;

  const items: BottomNavItem[] = [
    {
      to: "/dashboard",
      label: "Dashboard",
      icon: LayoutDashboard,
      active: (p) => p === "/dashboard",
    },
    {
      to: "/persediaan",
      label: "Master",
      icon: Boxes,
      permission: "inventory.view",
      active: (p) => p === "/persediaan" || p.startsWith("/persediaan/"),
    },
    {
      to: "/permintaan",
      label: "Permintaan",
      icon: Inbox,
      permission: "requests.view",
      badge: permintaanBadge,
      active: (p, t) =>
        (p === "/permintaan" && t !== "aktif") ||
        (p.startsWith("/permintaan/") && p !== "/permintaan/sisa"),
    },
    {
      to: "/permintaan?tab=aktif",
      label: "Kirim",
      icon: PackageCheck,
      permission: "requests.view",
      active: (p, t) => p === "/permintaan" && t === "aktif",
    },
    {
      to: "/permintaan/sisa",
      label: "Sisa",
      icon: Hourglass,
      permission: "requests.view",
      badge: sisaBadge,
      active: (p) => p === "/permintaan/sisa",
    },
  ];

  const visible = items.filter(
    (i) => !i.permission || hasPermission(i.permission)
  );
  if (visible.length === 0) return null;

  return (
    <nav
      aria-label="Menu utama"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-ink-800/85 backdrop-blur-xl lg:hidden print:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex">
        {visible.map((item) => {
          const isActive = item.active(pathname, tab);
          return (
            <Link
              key={item.to + item.label}
              to={item.to}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium",
                isActive ? "text-white" : "text-ink-300"
              )}
            >
              <span className="relative">
                <item.icon className="h-5 w-5" />
                {item.badge !== undefined && item.badge > 0 && (
                  <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-bold leading-none text-white">
                    {item.badge > 99 ? "99+" : item.badge}
                  </span>
                )}
              </span>
              {item.label}
              {isActive && (
                <span className="absolute inset-x-6 top-0 h-0.5 rounded-b-full bg-brand-600" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function AppLayout(): ReactNode {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  const [queueCounts, setQueueCounts] = useState<{
    diajukan: number;
    aktif: number;
    sisa: number;
    lowStock: number;
  }>({ diajukan: 0, aktif: 0, sisa: 0, lowStock: 0 });
  const { profile, user, isSuperAdmin, hasPermission, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [soundOn, setSoundOn] = useState(isNavSoundEnabled());
  const firstRoute = useRef(true);

  // Buka kunci audio saat interaksi pertama (browser memblokir audio sebelumnya).
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock);
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  // Bunyi lembut tiap pindah menu/dashboard (bukan saat pertama kali dibuka).
  useEffect(() => {
    if (firstRoute.current) {
      firstRoute.current = false;
      return;
    }
    playNavSound();
  }, [location.pathname, location.search]);

  useEffect(() => {
    setNotifOpen(false);
    setAccountOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!notifOpen && !accountOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (notifOpen && notifRef.current && !notifRef.current.contains(t)) setNotifOpen(false);
      if (accountOpen && accountRef.current && !accountRef.current.contains(t)) setAccountOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [notifOpen, accountOpen]);
  const roleLabel = getRoleLabel(profile?.roles?.name, isSuperAdmin);
  const displayName =
    profile?.full_name ??
    (profile as unknown as { display_name?: string } | null)?.display_name ??
    user?.email;

  useEffect(() => {
    if (!user || !hasPermission("requests.view")) return;
    let cancelled = false;
    (async () => {
      const [diajukanRes, aktifRes, sisaRes, itemsRes, balancesRes] = await Promise.all([
        supabase
          .from("requests")
          .select("id", { count: "exact", head: true })
          .eq("status", "diajukan"),
        supabase
          .from("requests")
          .select("id", { count: "exact", head: true })
          .in("status", ["disetujui", "disetujui_sebagian", "diproses"]),
        supabase
          .from("request_items")
          .select("id", { count: "exact", head: true })
          .in("item_status", ["pending_sebagian", "menunggu_stok"]),
        supabase.from("inventory_items").select("id, min_stock").eq("is_active", true),
        supabase.from("inventory_balances").select("item_id, qty"),
      ]);
      if (cancelled) return;
      // Hitung SKU di bawah stok minimum (sama seperti Dashboard).
      const stockByItem = new Map<string, number>();
      for (const b of (balancesRes.data ?? []) as { item_id: string; qty: number | string }[]) {
        stockByItem.set(b.item_id, (stockByItem.get(b.item_id) ?? 0) + Number(b.qty));
      }
      let lowStock = 0;
      for (const item of (itemsRes.data ?? []) as { id: string; min_stock: number | null }[]) {
        if (item.min_stock === null) continue;
        if ((stockByItem.get(item.id) ?? 0) < item.min_stock) lowStock++;
      }
      setQueueCounts({
        diajukan: diajukanRes.count ?? 0,
        aktif: aktifRes.count ?? 0,
        sisa: sisaRes.count ?? 0,
        lowStock,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [user, hasPermission, location.pathname]);

  const crumbs = buildCrumbs(location.pathname);
  const roleName = profile?.roles?.name;
  const permintaanBadge =
    roleName === "helper"
      ? queueCounts.aktif
      : queueCounts.diajukan + queueCounts.aktif;
  const badges: Record<string, number> = {
    "/permintaan": permintaanBadge,
    "/permintaan/sisa": queueCounts.sisa,
    "/persediaan/peringatan-stok": queueCounts.lowStock,
  };
  const totalNotif = queueCounts.diajukan + queueCounts.aktif + queueCounts.sisa + queueCounts.lowStock;

  return (
    <div className="relative flex min-h-screen overflow-x-clip bg-ink-800 bg-[radial-gradient(1000px_480px_at_85%_-10%,rgba(245,158,11,0.14),transparent),radial-gradient(800px_480px_at_0%_110%,rgba(59,130,246,0.12),transparent)]">
      {/* Cahaya latar kaca (oranye + biru), diam di belakang seluruh aplikasi */}
      <div className="animate-drift pointer-events-none fixed -right-24 -top-24 h-96 w-96 rounded-full bg-warn-500/10 blur-3xl" />
      <div className="animate-drift-slow pointer-events-none fixed -bottom-24 -left-24 h-96 w-96 rounded-full bg-info-500/10 blur-3xl" />
      {/* Sidebar desktop */}
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 border-r border-white/10 bg-ink-800/60 backdrop-blur-xl transition-all duration-200 lg:block print:hidden",
          collapsed ? "w-[76px]" : "w-[252px]"
        )}
      >
        <SidebarContent collapsed={collapsed} onNavigate={() => {}} badges={badges} />
      </aside>

      {/* Sidebar mobile */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden print:hidden">
          <div className="absolute inset-0 bg-ink-800/60 backdrop-blur-[2px]" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-[272px] border-r border-white/10 bg-ink-800/95 backdrop-blur-xl shadow-pop">
            <button
              type="button"
              aria-label="Tutup menu"
              className="absolute right-3 top-4 rounded-md p-1.5 text-ink-300 hover:bg-white/10 hover:text-white"
              onClick={() => setMobileOpen(false)}
            >
              <X className="h-5 w-5" />
            </button>
            <SidebarContent
              collapsed={false}
              onNavigate={() => setMobileOpen(false)}
              badges={badges}
            />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-white/10 bg-ink-800/70 backdrop-blur-xl px-4 md:px-6 print:hidden">
          <button
            type="button"
            aria-label="Menu"
            className="rounded-lg p-2 text-ink-200 transition-colors hover:bg-white/10 hover:text-white lg:hidden"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Ciutkan sidebar"
            className="hidden rounded-lg p-2 text-ink-300 transition-colors hover:bg-white/10 hover:text-white lg:block"
            onClick={() => setCollapsed((v) => !v)}
          >
            <Menu className="h-5 w-5" />
          </button>
          <nav
            aria-label="Breadcrumb"
            className="ml-1 hidden min-w-0 items-center gap-1.5 text-sm xl:flex"
          >
            {crumbs.map((c, i) => (
              <span key={c} className="flex min-w-0 items-center gap-1.5">
                {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-300" />}
                <span
                  className={cn(
                    "truncate",
                    i === crumbs.length - 1 ? "font-medium text-white" : "text-ink-300"
                  )}
                >
                  {c}
                </span>
              </span>
            ))}
          </nav>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-1.5">
            <Link
              to="/publik"
              target="_blank"
              className="hidden rounded-lg px-3 py-2 text-sm text-ink-300 transition-colors hover:bg-white/10 hover:text-white sm:block"
            >
              Lihat situs publik
            </Link>
            <button
              type="button"
              aria-label={soundOn ? "Matikan suara navigasi" : "Nyalakan suara navigasi"}
              aria-pressed={soundOn}
              title={soundOn ? "Suara navigasi: nyala" : "Suara navigasi: mati"}
              onClick={() => {
                const next = !soundOn;
                setSoundOn(next);
                setNavSoundEnabled(next);
              }}
              className="rounded-lg p-2 text-ink-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              {soundOn ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
            </button>
            <div className="relative" ref={notifRef}>
              <button
                type="button"
                aria-label="Notifikasi"
                onClick={() => setNotifOpen((v) => !v)}
                className="relative rounded-lg p-2 text-ink-300 transition-colors hover:bg-white/10 hover:text-white"
              >
                <Bell className="h-5 w-5" />
                {totalNotif > 0 && (
                  <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-brand-600 ring-2 ring-ink-800" />
                )}
              </button>
              {notifOpen && (
                <div className="absolute right-0 mt-2 w-72 rounded-xl border border-white/15 bg-ink-800/95 p-3 shadow-pop backdrop-blur-xl">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-ink-300">
                      Antrean Operasional
                    </span>
                    <button
                      type="button"
                      onClick={() => setNotifOpen(false)}
                      className="text-xs text-ink-300 hover:text-white"
                    >
                      Tutup
                    </button>
                  </div>
                  <div className="space-y-1.5 text-sm">
                    <Link
                      to="/permintaan"
                      onClick={() => setNotifOpen(false)}
                      className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 hover:bg-white/10"
                    >
                      <span className="text-white">Perlu Direview</span>
                      <span className="tnum font-semibold text-info-500">
                        {queueCounts.diajukan}
                      </span>
                    </Link>
                    <Link
                      to="/permintaan"
                      onClick={() => setNotifOpen(false)}
                      className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 hover:bg-white/10"
                    >
                      <span className="text-white">Aktif (Proses/Kirim)</span>
                      <span className="tnum font-semibold text-warn-500">
                        {queueCounts.aktif}
                      </span>
                    </Link>
                    <Link
                      to="/permintaan/sisa"
                      onClick={() => setNotifOpen(false)}
                      className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 hover:bg-white/10"
                    >
                      <span className="text-white">Sisa Belum Terkirim</span>
                      <span className="tnum font-semibold text-brand-200">
                        {queueCounts.sisa}
                      </span>
                    </Link>
                    <Link
                      to="/persediaan/peringatan-stok"
                      onClick={() => setNotifOpen(false)}
                      className="flex items-center justify-between rounded-lg bg-warn-500/15 px-3 py-2 hover:bg-warn-500/25"
                    >
                      <span className="text-white">Stok Menipis / Habis</span>
                      <span className="tnum font-semibold text-warn-500">
                        {queueCounts.lowStock}
                      </span>
                    </Link>
                  </div>
                </div>
              )}
            </div>
            <div className="mx-1 hidden h-8 w-px bg-white/10 sm:block" />
            <div className="relative" ref={accountRef}>
              <button
                type="button"
                onClick={() => setAccountOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={accountOpen}
                className="flex items-center gap-2 rounded-lg py-1.5 pl-1.5 pr-2 transition-colors hover:bg-white/10"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
                  {(displayName ?? "?").charAt(0).toUpperCase()}
                </span>
                <span className="hidden text-left sm:block">
                  <span className="block max-w-40 truncate text-sm font-medium leading-tight text-white">
                    {displayName}
                  </span>
                  <span className="block text-xs leading-tight text-ink-300">{roleLabel}</span>
                </span>
                <ChevronDown className={cn("hidden h-4 w-4 text-ink-300 transition-transform sm:block", accountOpen && "rotate-180")} />
              </button>
              {accountOpen && (
                <div className="absolute right-0 mt-2 w-56 rounded-xl border border-white/15 bg-ink-800/95 p-1.5 shadow-pop backdrop-blur-xl">
                  <div className="border-b border-white/10 px-3 py-2">
                    <p className="truncate text-sm font-medium text-white">{displayName}</p>
                    <p className="truncate text-xs text-ink-300">{user?.email}</p>
                  </div>
                  <Link
                    to="/pengaturan"
                    onClick={() => setAccountOpen(false)}
                    className="mt-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-200 transition-colors hover:bg-white/10"
                  >
                    <Settings className="h-4 w-4 text-ink-300" /> Pengaturan
                  </Link>
                  <button
                    type="button"
                    onClick={async () => {
                      setAccountOpen(false);
                      await signOut();
                      navigate("/login");
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-brand-200 transition-colors hover:bg-brand-600/20"
                  >
                    <LogOut className="h-4 w-4" /> Keluar
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="relative flex-1 p-4 pb-24 md:p-6 md:pb-24 lg:p-8">
          <div className="mx-auto max-w-[1400px]">
            <div key={location.pathname} className="animate-page-in">
              <Outlet />
            </div>
          </div>
        </main>
      </div>
      <BottomNav permintaanBadge={permintaanBadge} sisaBadge={queueCounts.sisa} />
      <Toaster richColors position="top-right" />
    </div>
  );
}
