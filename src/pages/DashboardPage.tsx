import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, ArrowLeftRight, Boxes, Package } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { StatCard } from "../components/StatCard";
import { PageHeader } from "../components/PageHeader";
import { Skeleton } from "../components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import type { AssetStatus } from "../types/database";
import { ASSET_STATUS_LABELS } from "../types/database";

interface TxDay {
  date: string;
  count: number;
}

interface StatusSlice {
  status: AssetStatus;
  label: string;
  count: number;
}

interface DashboardState {
  totalAssets: number;
  totalSku: number;
  lowStockCount: number;
  tx30: number;
  tx14: TxDay[];
  byStatus: StatusSlice[];
}

const STATUS_COLORS: Record<AssetStatus, string> = {
  tersedia: "#16a34a",
  digunakan: "#2f7de1",
  dipinjamkan: "#d97706",
  perbaikan: "#eab308",
  rusak: "#dc2626",
  dipensiunkan: "#64748b",
};

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000)
          .toISOString()
          .slice(0, 10);
        const [
          assetsCountRes,
          statusesRes,
          itemsRes,
          balancesRes,
          txCountRes,
          txRecentRes,
        ] = await Promise.all([
          supabase
            .from("assets")
            .select("id", { count: "exact", head: true })
            .eq("archived", false),
          supabase.from("assets").select("status").eq("archived", false),
          supabase.from("inventory_items").select("id, min_stock").eq("is_active", true),
          supabase.from("inventory_balances").select("item_id, qty"),
          supabase
            .from("inventory_transactions")
            .select("id", { count: "exact", head: true })
            .gte("transaction_date", thirtyDaysAgo),
          supabase
            .from("inventory_transactions")
            .select("transaction_date")
            .order("transaction_date", { ascending: false })
            .limit(200),
        ]);
        const failures = [
          assetsCountRes,
          statusesRes,
          itemsRes,
          balancesRes,
          txCountRes,
          txRecentRes,
        ].filter((r) => r.error);
        if (failures.length > 0) throw new Error("Gagal memuat data dashboard");

        const statuses = (statusesRes.data ?? []) as { status: AssetStatus }[];
        const items = (itemsRes.data ?? []) as { id: string; min_stock: number | null }[];
        const balances = (balancesRes.data ?? []) as { item_id: string; qty: number }[];
        const txRecent = (txRecentRes.data ?? []) as { transaction_date: string }[];

        // Agregasi stok per item (client-side) untuk hitung SKU di bawah minimum.
        const balanceByItem = new Map<string, number>();
        for (const b of balances) {
          balanceByItem.set(b.item_id, (balanceByItem.get(b.item_id) ?? 0) + Number(b.qty));
        }
        let lowStockCount = 0;
        for (const item of items) {
          if (item.min_stock === null) continue;
          const total = balanceByItem.get(item.id) ?? 0;
          if (total < item.min_stock) lowStockCount++;
        }

        // Transaksi 14 hari terakhir, group by transaction_date.
        const tx14: TxDay[] = [];
        const dayIndex = new Map<string, number>();
        for (let i = 13; i >= 0; i--) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          const key = d.toISOString().slice(0, 10);
          dayIndex.set(key, tx14.length);
          tx14.push({ date: key, count: 0 });
        }
        for (const t of txRecent) {
          const idx = dayIndex.get(String(t.transaction_date).slice(0, 10));
          if (idx !== undefined) tx14[idx].count++;
        }

        // Aset per status, group client-side.
        const countByStatus = new Map<AssetStatus, number>();
        for (const a of statuses) {
          countByStatus.set(a.status, (countByStatus.get(a.status) ?? 0) + 1);
        }
        const byStatus: StatusSlice[] = [...countByStatus.entries()].map(
          ([status, count]) => ({ status, label: ASSET_STATUS_LABELS[status], count })
        );

        if (cancelled) return;
        setData({
          totalAssets: assetsCountRes.count ?? 0,
          totalSku: items.length,
          lowStockCount,
          tx30: txCountRes.count ?? 0,
          tx14,
          byStatus,
        });
      } catch {
        if (!cancelled) toast.error("Gagal memuat data dashboard");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || !data) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8">
        <PageHeader title="Dashboard" description="Ringkasan operasional aset & gudang" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <PageHeader title="Dashboard" description="Ringkasan operasional aset & gudang" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Aset"
          value={data.totalAssets.toLocaleString("id-ID")}
          description="Aset aktif (tidak diarsip)"
          icon={Boxes}
          accent="navy"
        />
        <StatCard
          title="Total SKU Aktif"
          value={data.totalSku.toLocaleString("id-ID")}
          description="Item persediaan aktif"
          icon={Package}
          accent="blue"
        />
        <StatCard
          title="SKU di Bawah Stok Minimum"
          value={data.lowStockCount.toLocaleString("id-ID")}
          description="Perlu restock"
          icon={AlertTriangle}
          accent={data.lowStockCount > 0 ? "yellow" : "green"}
        />
        <StatCard
          title="Transaksi 30 Hari"
          value={data.tx30.toLocaleString("id-ID")}
          description="Dokumen transaksi tercatat"
          icon={ArrowLeftRight}
          accent="green"
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Transaksi 14 Hari Terakhir</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data.tx14} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11 }} interval={2} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip
                  labelFormatter={(label) => shortDate(String(label))}
                  formatter={(value) => [value, "Transaksi"]}
                />
                <Bar dataKey="count" name="Transaksi" fill="#3467a3" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Aset per Status</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={data.byStatus}
                  dataKey="count"
                  nameKey="label"
                  outerRadius={105}
                  label
                >
                  {data.byStatus.map((s) => (
                    <Cell key={s.status} fill={STATUS_COLORS[s.status]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => [value, "Aset"]} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
