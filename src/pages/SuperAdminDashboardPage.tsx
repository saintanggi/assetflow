import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeftRight,
  Boxes,
  Coins,
  FileClock,
  Settings,
  ShieldCheck,
  TriangleAlert,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { formatDateTime, formatQty, formatRupiah, timeAgo } from "../lib/format";
import { StatCard } from "../components/StatCard";
import { PageHeader } from "../components/PageHeader";
import { Skeleton } from "../components/ui/skeleton";
import { Badge } from "../components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { EmptyState } from "../components/EmptyState";

interface AuditRow {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  created_at: string;
  // Join supabase mengembalikan relasi sebagai array (atau null).
  profiles: { email: string; full_name: string | null }[] | null;
}

function auditActor(row: AuditRow): string {
  const p = row.profiles?.[0];
  return p?.full_name ?? p?.email ?? "Sistem";
}

interface LowStockItem {
  id: string;
  sku: string;
  name: string;
  balance: number;
  minStock: number;
}

interface QuickLink {
  to: string;
  icon: LucideIcon;
  title: string;
  description: string;
}

const QUICK_LINKS: QuickLink[] = [
  { to: "/pengguna", icon: Users, title: "Pengguna", description: "Kelola akun & akses staf" },
  { to: "/peran", icon: ShieldCheck, title: "Peran", description: "Peran & hak akses" },
  { to: "/audit", icon: FileClock, title: "Audit Log", description: "Jejak aktivitas sistem" },
  { to: "/pengaturan", icon: Settings, title: "Pengaturan", description: "Konfigurasi aplikasi" },
];

export function SuperAdminDashboardPage() {
  const [totalUsers, setTotalUsers] = useState(0);
  const [totalAssets, setTotalAssets] = useState(0);
  const [totalValue, setTotalValue] = useState(0);
  const [txThisMonth, setTxThisMonth] = useState(0);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [lowStock, setLowStock] = useState<LowStockItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const now = new Date();
        const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
        const [
          usersRes,
          assetsCountRes,
          assetsValueRes,
          txRes,
          auditRes,
          itemsRes,
          balancesRes,
        ] = await Promise.all([
          supabase.from("profiles").select("id", { count: "exact", head: true }),
          supabase.from("assets").select("id", { count: "exact", head: true }).eq("archived", false),
          // Nilai aset hanya boleh dilihat super admin — halaman ini sudah di-guard RequireSuperAdmin.
          supabase.from("assets").select("purchase_price").eq("archived", false),
          supabase
            .from("inventory_transactions")
            .select("id", { count: "exact", head: true })
            .gte("transaction_date", monthStart),
          supabase
            .from("audit_logs")
            .select("id, action, entity_type, entity_id, created_at, profiles(email, full_name)")
            .order("created_at", { ascending: false })
            .limit(5),
          supabase
            .from("inventory_items")
            .select("id, sku, name, min_stock")
            .eq("is_active", true)
            .not("min_stock", "is", null),
          supabase.from("inventory_balances").select("item_id, qty"),
        ]);
        const failures = [usersRes, assetsCountRes, assetsValueRes, txRes, auditRes, itemsRes, balancesRes].filter(
          (r) => r.error
        );
        if (failures.length > 0) throw new Error("Gagal memuat data admin");

        if (cancelled) return;

        setTotalUsers(usersRes.count ?? 0);
        setTotalAssets(assetsCountRes.count ?? 0);
        const values = (assetsValueRes.data ?? []) as { purchase_price: number | null }[];
        setTotalValue(values.reduce((sum, a) => sum + (Number(a.purchase_price) || 0), 0));
        setTxThisMonth(txRes.count ?? 0);
        setAudit((auditRes.data ?? []) as AuditRow[]);

        // 5 SKU dengan selisih stok vs minimum terendah.
        const items = (itemsRes.data ?? []) as {
          id: string;
          sku: string;
          name: string;
          min_stock: number | null;
        }[];
        const balances = (balancesRes.data ?? []) as { item_id: string; qty: number }[];
        const balanceByItem = new Map<string, number>();
        for (const b of balances) {
          balanceByItem.set(b.item_id, (balanceByItem.get(b.item_id) ?? 0) + Number(b.qty));
        }
        const ranked: LowStockItem[] = items
          .filter((i) => i.min_stock !== null)
          .map((i) => ({
            id: i.id,
            sku: i.sku,
            name: i.name,
            balance: balanceByItem.get(i.id) ?? 0,
            minStock: i.min_stock as number,
          }))
          .sort((a, b) => a.balance - a.minStock - (b.balance - b.minStock))
          .slice(0, 5);
        setLowStock(ranked);
      } catch {
        if (!cancelled) toast.error("Gagal memuat dashboard admin");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8">
        <PageHeader title="Panel Super Admin" description="Ringkasan sistem & peringatan" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <PageHeader
        title="Panel Super Admin"
        description="Ringkasan sistem, aktivitas terakhir, dan peringatan stok"
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Pengguna"
          value={totalUsers.toLocaleString("id-ID")}
          description="Akun terdaftar"
          icon={Users}
          accent="navy"
        />
        <StatCard
          title="Total Aset"
          value={totalAssets.toLocaleString("id-ID")}
          description="Aset aktif (tidak diarsip)"
          icon={Boxes}
          accent="blue"
        />
        <StatCard
          title="Total Nilai Aset"
          value={formatRupiah(totalValue)}
          description="Hanya terlihat oleh super admin"
          icon={Coins}
          accent="green"
        />
        <StatCard
          title="Transaksi Bulan Berjalan"
          value={txThisMonth.toLocaleString("id-ID")}
          description="Dokumen transaksi tercatat"
          icon={ArrowLeftRight}
          accent="yellow"
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Aktivitas Terakhir</CardTitle>
            <CardDescription>5 kejadian terbaru di audit log</CardDescription>
          </CardHeader>
          <CardContent>
            {audit.length === 0 ? (
              <EmptyState title="Belum ada aktivitas" description="Audit log masih kosong." />
            ) : (
              <ul className="divide-y divide-white/5">
                {audit.map((row) => (
                  <li key={row.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-200">
                        {row.action}
                        <span className="ml-2 font-normal text-slate-500">
                          {row.entity_type}
                          {row.entity_id ? ` • ${row.entity_id.slice(0, 8)}` : ""}
                        </span>
                      </p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {auditActor(row)}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-slate-400" title={formatDateTime(row.created_at)}>
                      {timeAgo(row.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Peringatan Stok Rendah</CardTitle>
            <CardDescription>5 SKU dengan selisih stok vs minimum terendah</CardDescription>
          </CardHeader>
          <CardContent>
            {lowStock.length === 0 ? (
              <EmptyState title="Stok aman" description="Tidak ada SKU di bawah stok minimum." />
            ) : (
              <ul className="divide-y divide-white/5">
                {lowStock.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="rounded-lg bg-amber-400/10 p-2">
                        <TriangleAlert className="h-4 w-4 text-amber-300" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-200">
                          {item.name}
                          <span className="ml-2 font-mono text-xs text-slate-400">{item.sku}</span>
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          Stok {formatQty(item.balance)} / Min {formatQty(item.minStock)}
                        </p>
                      </div>
                    </div>
                    <Badge variant={item.balance < item.minStock ? "warning" : "success"}>
                      {item.balance < item.minStock ? "Di bawah minimum" : "Sesuai minimum"}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Aksi Cepat</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {QUICK_LINKS.map(({ to, icon: Icon, title, description }) => (
              <Link
                key={to}
                to={to}
                className="flex items-center gap-3 rounded-xl border border-white/10 p-4 transition-colors hover:border-brand-400/30 hover:bg-brand-400/10"
              >
                <div className="rounded-lg bg-white/5 p-2.5 text-slate-300">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{title}</p>
                  <p className="text-xs text-slate-500">{description}</p>
                </div>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
