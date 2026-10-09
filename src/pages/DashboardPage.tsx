import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  Package,
  Warehouse,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { Skeleton } from "../components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import type { AssetStatus, TransactionType } from "../types/database";
import { ASSET_STATUS_LABELS, TRANSACTION_TYPE_LABELS } from "../types/database";
import { cn } from "../lib/utils";

interface TxDay {
  date: string;
  count: number;
}

interface StatusSlice {
  status: AssetStatus;
  label: string;
  count: number;
}

interface RecentTx {
  id: string;
  transaction_number: string;
  type: TransactionType;
  created_at: string;
}

interface LocationStock {
  code: string;
  name: string;
  qty: number;
}

interface DashboardState {
  totalStock: number;
  totalSku: number;
  lowStockCount: number;
  inboundToday: number;
  outboundToday: number;
  tx14: TxDay[];
  byStatus: StatusSlice[];
  recent: RecentTx[];
  locStock: LocationStock[];
}

const STATUS_COLORS: Record<AssetStatus, string> = {
  tersedia: "#2dd4bf",
  digunakan: "#60a5fa",
  dipinjamkan: "#fbbf24",
  perbaikan: "#fb923c",
  rusak: "#fb7185",
  dipensiunkan: "#64748b",
};

const TX_ICON: Record<TransactionType, typeof ArrowDownToLine> = {
  in: ArrowDownToLine,
  out: ArrowUpFromLine,
  transfer: Activity,
  adjust: Activity,
  opname: Activity,
  return: ArrowDownToLine,
};

const TX_COLOR: Record<TransactionType, string> = {
  in: "text-brand-300 bg-brand-400/10 border-brand-400/20",
  out: "text-amber-300 bg-amber-400/10 border-amber-400/20",
  transfer: "text-sky-300 bg-sky-400/10 border-sky-400/20",
  adjust: "text-violet-300 bg-violet-400/10 border-violet-400/20",
  opname: "text-violet-300 bg-violet-400/10 border-violet-400/20",
  return: "text-brand-300 bg-brand-400/10 border-brand-400/20",
};

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: typeof Boxes;
  label: string;
  value: string;
  sub: string;
  tone: "teal" | "amber" | "blue" | "violet";
}) {
  const toneClass = {
    teal: "text-brand-300",
    amber: "text-amber-300",
    blue: "text-sky-300",
    violet: "text-violet-300",
  }[tone];
  return (
    <Card className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-400/40 to-transparent" />
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-slate-500">{label}</p>
            <p className="tnum mt-2 text-4xl font-bold tracking-tight text-white">{value}</p>
            <p className="mt-1.5 text-xs text-slate-500">{sub}</p>
          </div>
          <div className={cn("rounded-xl bg-white/5 p-2.5 ring-1 ring-white/10", toneClass)}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const today = new Date().toISOString().slice(0, 10);
        const [
          statusesRes,
          itemsRes,
          balancesRes,
          txTodayRes,
          txRecentRes,
          recentListRes,
          locRes,
        ] = await Promise.all([
          supabase.from("assets").select("status").eq("archived", false),
          supabase.from("inventory_items").select("id, min_stock").eq("is_active", true),
          supabase.from("inventory_balances").select("item_id, qty, location_id"),
          supabase
            .from("inventory_transactions")
            .select("type")
            .eq("transaction_date", today),
          supabase
            .from("inventory_transactions")
            .select("transaction_date")
            .order("transaction_date", { ascending: false })
            .limit(200),
          supabase
            .from("inventory_transactions")
            .select("id, transaction_number, type, created_at")
            .order("created_at", { ascending: false })
            .limit(8),
          supabase.from("locations").select("id, code, name"),
        ]);
        const failures = [
          statusesRes,
          itemsRes,
          balancesRes,
          txTodayRes,
          txRecentRes,
          recentListRes,
          locRes,
        ].filter((r) => r.error);
        if (failures.length > 0) throw new Error("Gagal memuat data dashboard");

        const statuses = (statusesRes.data ?? []) as { status: AssetStatus }[];
        const items = (itemsRes.data ?? []) as { id: string; min_stock: number | null }[];
        const balances = (balancesRes.data ?? []) as {
          item_id: string;
          qty: number;
          location_id: string;
        }[];
        const txToday = (txTodayRes.data ?? []) as { type: TransactionType }[];
        const txRecent = (txRecentRes.data ?? []) as { transaction_date: string }[];

        const balanceByItem = new Map<string, number>();
        const balanceByLoc = new Map<string, number>();
        let totalStock = 0;
        for (const b of balances) {
          const q = Number(b.qty);
          totalStock += q;
          balanceByItem.set(b.item_id, (balanceByItem.get(b.item_id) ?? 0) + q);
          balanceByLoc.set(b.location_id, (balanceByLoc.get(b.location_id) ?? 0) + q);
        }

        let lowStockCount = 0;
        for (const item of items) {
          if (item.min_stock === null) continue;
          if ((balanceByItem.get(item.id) ?? 0) < item.min_stock) lowStockCount++;
        }

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

        const countByStatus = new Map<AssetStatus, number>();
        for (const a of statuses) {
          countByStatus.set(a.status, (countByStatus.get(a.status) ?? 0) + 1);
        }
        const byStatus: StatusSlice[] = [...countByStatus.entries()].map(
          ([status, count]) => ({ status, label: ASSET_STATUS_LABELS[status], count })
        );

        const locMap = new Map(
          ((locRes.data ?? []) as { id: string; code: string; name: string }[]).map((l) => [
            l.id,
            l,
          ])
        );
        const locStock: LocationStock[] = [...balanceByLoc.entries()]
          .map(([id, qty]) => ({
            code: locMap.get(id)?.code ?? "—",
            name: locMap.get(id)?.name ?? "Tanpa lokasi",
            qty,
          }))
          .sort((a, b) => b.qty - a.qty)
          .slice(0, 5);

        if (cancelled) return;
        setData({
          totalStock,
          totalSku: items.length,
          lowStockCount,
          inboundToday: txToday.filter((t) => t.type === "in").length,
          outboundToday: txToday.filter((t) => t.type === "out").length,
          tx14,
          byStatus,
          recent: (recentListRes.data ?? []) as RecentTx[],
          locStock,
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
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-80 w-full lg:col-span-2" />
          <Skeleton className="h-80 w-full" />
        </div>
      </div>
    );
  }

  const maxLoc = Math.max(1, ...data.locStock.map((l) => l.qty));
  const now = new Date().toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-5">
      {/* Command header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-display text-2xl font-bold tracking-tight text-white">
              Command Center
            </h1>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-400/30 bg-brand-400/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-widest text-brand-300">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-400" />
              </span>
              Live
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">{now} — pantauan operasional gudang real-time</p>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={Boxes}
          label="Total Stok"
          value={data.totalStock.toLocaleString("id-ID")}
          sub={`${data.totalSku.toLocaleString("id-ID")} SKU aktif tercatat`}
          tone="teal"
        />
        <StatTile
          icon={ArrowDownToLine}
          label="Inbound Hari Ini"
          value={data.inboundToday.toLocaleString("id-ID")}
          sub="Dokumen barang masuk"
          tone="blue"
        />
        <StatTile
          icon={ArrowUpFromLine}
          label="Outbound Hari Ini"
          value={data.outboundToday.toLocaleString("id-ID")}
          sub="Dokumen barang keluar"
          tone="violet"
        />
        <StatTile
          icon={AlertTriangle}
          label="Perlu Perhatian"
          value={data.lowStockCount.toLocaleString("id-ID")}
          sub="SKU di bawah stok minimum"
          tone="amber"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Activity chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="font-display text-base text-white">
                Aktivitas Transaksi
              </CardTitle>
              <p className="mt-0.5 text-xs text-slate-500">14 hari terakhir</p>
            </div>
            <span className="tnum rounded-md border border-white/10 bg-white/5 px-2 py-1 font-mono text-xs text-slate-400">
              {data.tx14.reduce((s, d) => s + d.count, 0)} dokumen
            </span>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={data.tx14} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="txFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2dd4bf" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#2dd4bf" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1a2233" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={shortDate}
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  interval={2}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  labelFormatter={(label) => shortDate(String(label))}
                  formatter={(value) => [value, "Transaksi"]}
                  contentStyle={{
                    background: "#131a28",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                    color: "#fff",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  name="Transaksi"
                  stroke="#2dd4bf"
                  strokeWidth={2}
                  fill="url(#txFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Live feed */}
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-base text-white">Aktivitas Terakhir</CardTitle>
            <p className="mt-0.5 text-xs text-slate-500">Dokumen terbaru tercatat</p>
          </CardHeader>
          <CardContent className="space-y-1">
            {data.recent.length === 0 && (
              <p className="py-8 text-center text-sm text-slate-500">Belum ada transaksi.</p>
            )}
            {data.recent.map((t) => {
              const Icon = TX_ICON[t.type];
              return (
                <div
                  key={t.id}
                  className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-white/5"
                >
                  <span
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
                      TX_COLOR[t.type]
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="tnum truncate font-mono text-[13px] font-semibold text-slate-200">
                      {t.transaction_number}
                    </p>
                    <p className="text-xs text-slate-500">
                      {TRANSACTION_TYPE_LABELS[t.type]} •{" "}
                      {new Date(t.created_at).toLocaleString("id-ID", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Stock per location */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-base text-white">
              <Warehouse className="h-4 w-4 text-brand-300" />
              Distribusi Stok per Lokasi
            </CardTitle>
            <p className="mt-0.5 text-xs text-slate-500">5 lokasi dengan stok terbesar</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.locStock.length === 0 && (
              <p className="py-8 text-center text-sm text-slate-500">Belum ada stok tercatat.</p>
            )}
            {data.locStock.map((l) => (
              <div key={l.code}>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <p className="text-sm font-medium text-slate-200">
                    <span className="tnum font-mono text-brand-300">{l.code}</span>
                    <span className="ml-2 text-slate-400">{l.name}</span>
                  </p>
                  <p className="tnum font-mono text-sm text-slate-300">
                    {l.qty.toLocaleString("id-ID")}
                  </p>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/5">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-300 transition-all"
                    style={{ width: `${Math.max(4, (l.qty / maxLoc) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Asset status donut */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-base text-white">
              <Package className="h-4 w-4 text-brand-300" />
              Aset per Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={data.byStatus}
                  dataKey="count"
                  nameKey="label"
                  innerRadius={58}
                  outerRadius={88}
                  paddingAngle={3}
                  strokeWidth={0}
                >
                  {data.byStatus.map((s) => (
                    <Cell key={s.status} fill={STATUS_COLORS[s.status]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value) => [value, "Aset"]}
                  contentStyle={{
                    background: "#131a28",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                    color: "#fff",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="mt-2 space-y-1.5">
              {data.byStatus.map((s) => (
                <div key={s.status} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-slate-400">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: STATUS_COLORS[s.status] }}
                    />
                    {s.label}
                  </span>
                  <span className="tnum font-mono text-slate-200">
                    {s.count.toLocaleString("id-ID")}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
