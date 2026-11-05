import { useEffect, useState, type HTMLAttributes } from "react";
import { Link } from "react-router-dom";
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
  Banknote,
  Boxes,
  CheckCircle2,
  ChevronRight,
  Hourglass,
  Inbox,
  Package,
  PackageCheck,
  Warehouse,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { Skeleton } from "../components/ui/skeleton";
import { CardContent, CardHeader, CardTitle } from "../components/ui/card";
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
  doc_number: string;
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
  totalValue: number;
  lowStockCount: number;
  reviewCount: number;
  activeCount: number;
  pendingCount: number;
  inboundToday: number;
  outboundToday: number;
  tx14: TxDay[];
  byStatus: StatusSlice[];
  recent: RecentTx[];
  locStock: LocationStock[];
}

// Warna donut diterangkan supaya terbaca di atas kaca gelap.
const STATUS_COLORS: Record<AssetStatus, string> = {
  tersedia: "#22C55E",
  digunakan: "#60A5FA",
  dipinjamkan: "#FBBF24",
  perbaikan: "#F59E0B",
  rusak: "#F87171",
  dipensiunkan: "#9CA3AF",
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
  in: "text-ok-700 bg-ok-50 border-ok-100",
  out: "text-info-700 bg-info-50 border-info-100",
  transfer: "text-info-700 bg-info-50 border-info-100",
  adjust: "text-warn-700 bg-warn-50 border-warn-100",
  opname: "text-warn-700 bg-warn-50 border-warn-100",
  return: "text-ok-700 bg-ok-50 border-ok-100",
};

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

// Format Rupiah ringkas: Rp 1,2 M / Rp 850 rb / Rp 45.000.
function formatRupiah(v: number): string {
  if (v >= 1_000_000_000) return `Rp ${(v / 1_000_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} M`;
  if (v >= 1_000_000) return `Rp ${(v / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`;
  if (v >= 1_000) return `Rp ${(v / 1_000).toLocaleString("id-ID", { maximumFractionDigits: 0 })} rb`;
  return `Rp ${v.toLocaleString("id-ID")}`;
}

/** Permukaan kaca gelap (glassmorphism, ala "Glassy Dashboard V7") — khusus dashboard. */
function GlassCard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/15 bg-white/[0.07] shadow-[0_8px_32px_rgba(2,6,23,0.35)] backdrop-blur-xl",
        className
      )}
      {...props}
    />
  );
}

const DARK_TOOLTIP = {
  background: "#0F172A",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 8,
  color: "#F1F5F9",
  boxShadow: "0 8px 28px rgba(2,6,23,0.45)",
  fontSize: 12,
} as const;

function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  tone,
  delay = 0,
}: {
  icon: typeof Boxes;
  label: string;
  value: string;
  sub: string;
  tone: "teal" | "amber" | "blue" | "violet";
  delay?: number;
}) {
  const toneClass = {
    teal: "text-ok-100",
    amber: "text-warn-100",
    blue: "text-info-100",
    violet: "text-white",
  }[tone];
  const toneRing = {
    teal: "bg-ok-500/15 ring-ok-500/25",
    amber: "bg-warn-500/15 ring-warn-500/25",
    blue: "bg-info-500/15 ring-info-500/25",
    violet: "bg-white/10 ring-white/15",
  }[tone];
  return (
    <GlassCard className="animate-glass-in relative overflow-hidden" style={{ animationDelay: `${delay}ms` }}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent" />
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-ink-300">{label}</p>
            <p className="tnum mt-2 text-4xl font-bold tracking-tight text-white">{value}</p>
            <p className="mt-1.5 text-xs text-ink-300">{sub}</p>
          </div>
          <div className={cn("rounded-xl p-2.5 ring-1", toneRing, toneClass)}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </GlassCard>
  );
}

type ActionTone = "amber" | "blue" | "red";

const ACTION_TONE: Record<
  ActionTone | "green",
  { chip: string; count: string }
> = {
  amber: { chip: "bg-warn-500/15 text-warn-100 ring-warn-500/25", count: "text-warn-500" },
  blue: { chip: "bg-info-500/15 text-info-100 ring-info-500/25", count: "text-info-500" },
  red: { chip: "bg-brand-500/15 text-brand-100 ring-brand-500/25", count: "text-brand-200" },
  green: { chip: "bg-ok-500/15 text-ok-100 ring-ok-500/25", count: "text-ok-500" },
};

/** Kartu antrean "Perlu Tindakan" — jumlahnya merah/kuning kalau ada yang menunggu, hijau kalau beres. */
function ActionCard({
  to,
  icon: Icon,
  label,
  sub,
  count,
  tone,
  delay = 0,
}: {
  to: string;
  icon: typeof Boxes;
  label: string;
  sub: string;
  count: number;
  tone: ActionTone;
  delay?: number;
}) {
  const effectiveTone = count > 0 ? tone : "green";
  const styles = ACTION_TONE[effectiveTone];
  const DisplayIcon = count > 0 ? Icon : CheckCircle2;
  return (
    <Link
      to={to}
      className="animate-glass-in block transition hover:-translate-y-0.5"
      style={{ animationDelay: `${delay}ms` }}
    >
      <GlassCard>
        <CardContent className="flex items-center gap-3 p-4">
          <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1", styles.chip)}>
            <DisplayIcon className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-white">{label}</span>
            <span className="block truncate text-xs text-ink-300">
              {count > 0 ? sub : "Tidak ada antrean"}
            </span>
          </span>
          <span className={cn("tnum text-3xl font-bold tracking-tight", styles.count)}>
            {count.toLocaleString("id-ID")}
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-ink-400" />
        </CardContent>
      </GlassCard>
    </Link>
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
          reviewRes,
          activeRes,
          pendingRes,
        ] = await Promise.all([
          supabase.from("assets").select("status").eq("archived", false),
          supabase.from("inventory_items").select("id, min_stock, purchase_price").eq("is_active", true),
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
            .select("id, doc_number, type, created_at")
            .order("created_at", { ascending: false })
            .limit(8),
          supabase.from("locations").select("id, code, name"),
          // Antrean "Perlu Tindakan" (definisi sama seperti badge di sidebar).
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
        ]);
        const failures = [
          statusesRes,
          itemsRes,
          balancesRes,
          txTodayRes,
          txRecentRes,
          recentListRes,
          locRes,
          reviewRes,
          activeRes,
          pendingRes,
        ].filter((r) => r.error);
        if (failures.length > 0) throw new Error("Gagal memuat data dashboard");

        const statuses = (statusesRes.data ?? []) as { status: AssetStatus }[];
        const items = (itemsRes.data ?? []) as { id: string; min_stock: number | null; purchase_price: number | null }[];
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
        let totalValue = 0;
        for (const item of items) {
          if (item.min_stock === null) continue;
          if ((balanceByItem.get(item.id) ?? 0) < item.min_stock) lowStockCount++;
        }
        // Nilai stok = Σ (stok akhir × harga beli).
        for (const item of items) {
          const qty = balanceByItem.get(item.id) ?? 0;
          totalValue += qty * Number(item.purchase_price ?? 0);
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
          totalValue,
          lowStockCount,
          reviewCount: reviewRes.count ?? 0,
          activeCount: activeRes.count ?? 0,
          pendingCount: pendingRes.count ?? 0,
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
      <div className="space-y-4 p-5 sm:p-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full bg-white/10" />
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full bg-white/10" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-80 w-full bg-white/10 lg:col-span-2" />
          <Skeleton className="h-80 w-full bg-white/10" />
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
    <div className="relative space-y-5 overflow-hidden rounded-3xl bg-[radial-gradient(1000px_480px_at_85%_-10%,rgba(245,158,11,0.20),transparent),radial-gradient(800px_480px_at_0%_110%,rgba(59,130,246,0.16),transparent)] p-5 sm:p-6">
      {/* Cahaya latar ala video (oranye + biru, blur) */}
      <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-warn-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-info-500/15 blur-3xl" />
      <div className="relative space-y-5">
      {/* Command header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-display text-2xl font-bold tracking-tight text-white">
              Command Center
            </h1>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-ok-500/30 bg-ok-500/10 px-2.5 py-1 text-xs font-semibold uppercase tracking-widest text-ok-100">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok-500 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-ok-500" />
              </span>
              Live
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-300">{now} — pantauan operasional gudang real-time</p>
        </div>
      </div>

      {/* Perlu Tindakan — antrean yang butuh tindak lanjut, klik kartu untuk membuka */}
      <div>
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="font-display text-base font-bold text-white">Perlu Tindakan</h2>
          <p className="text-xs text-ink-300">Antrean yang butuh tindak lanjut hari ini</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ActionCard
            to="/permintaan?tab=diajukan"
            icon={Inbox}
            label="Perlu Direview"
            sub="tiket menunggu direview"
            count={data.reviewCount}
            tone="amber"
            delay={0}
          />
          <ActionCard
            to="/permintaan?tab=aktif"
            icon={PackageCheck}
            label="Sedang Diproses"
            sub="tiket proses / kirim"
            count={data.activeCount}
            tone="blue"
            delay={70}
          />
          <ActionCard
            to="/permintaan/sisa"
            icon={Hourglass}
            label="Sisa Belum Terkirim"
            sub="baris barang belum terkirim"
            count={data.pendingCount}
            tone="amber"
            delay={140}
          />
          <ActionCard
            to="/persediaan/peringatan-stok"
            icon={AlertTriangle}
            label="Stok Menipis / Habis"
            sub="SKU di bawah stok minimum"
            count={data.lowStockCount}
            tone="red"
            delay={210}
          />
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile
          icon={Boxes}
          label="Total Stok"
          value={data.totalStock.toLocaleString("id-ID")}
          sub={`${data.totalSku.toLocaleString("id-ID")} SKU aktif tercatat`}
          tone="teal"
          delay={0}
        />
        <StatTile
          icon={Banknote}
          label="Nilai Stok"
          value={formatRupiah(data.totalValue)}
          sub="Stok akhir × harga beli"
          tone="teal"
          delay={70}
        />
        <StatTile
          icon={ArrowDownToLine}
          label="Inbound Hari Ini"
          value={data.inboundToday.toLocaleString("id-ID")}
          sub="Dokumen barang masuk"
          tone="blue"
          delay={140}
        />
        <StatTile
          icon={ArrowUpFromLine}
          label="Outbound Hari Ini"
          value={data.outboundToday.toLocaleString("id-ID")}
          sub="Dokumen barang keluar"
          tone="violet"
          delay={210}
        />
        <Link to="/persediaan/peringatan-stok" className="block transition hover:-translate-y-0.5">
          <StatTile
            icon={AlertTriangle}
            label="Perlu Perhatian"
            value={data.lowStockCount.toLocaleString("id-ID")}
            sub="SKU di bawah stok minimum — klik untuk detail"
            tone="amber"
            delay={280}
          />
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Activity chart */}
        <GlassCard className="animate-glass-in lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="font-display text-base text-white">
                Aktivitas Transaksi
              </CardTitle>
              <p className="mt-0.5 text-xs text-ink-300">14 hari terakhir</p>
            </div>
            <span className="tnum rounded-md border border-white/15 bg-white/10 px-2 py-1 font-mono text-xs text-ink-200">
              {data.tx14.reduce((s, d) => s + d.count, 0)} dokumen
            </span>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={data.tx14} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="txFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#F97316" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#F97316" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={shortDate}
                  tick={{ fontSize: 11, fill: "#94A3B8" }}
                  interval={2}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: "#94A3B8" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  labelFormatter={(label) => shortDate(String(label))}
                  formatter={(value) => [value, "Transaksi"]}
                  contentStyle={DARK_TOOLTIP}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  name="Transaksi"
                  stroke="#F97316"
                  strokeWidth={2}
                  fill="url(#txFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </GlassCard>

        {/* Live feed */}
        <GlassCard className="animate-glass-in" style={{ animationDelay: "90ms" }}>
          <CardHeader>
            <CardTitle className="font-display text-base text-white">Aktivitas Terakhir</CardTitle>
            <p className="mt-0.5 text-xs text-ink-300">Dokumen terbaru tercatat</p>
          </CardHeader>
          <CardContent className="space-y-1">
            {data.recent.length === 0 && (
              <p className="py-8 text-center text-sm text-ink-300">Belum ada transaksi.</p>
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
                    <p className="tnum truncate font-mono text-[13px] font-semibold text-white">
                      {t.doc_number}
                    </p>
                    <p className="text-xs text-ink-300">
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
        </GlassCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Stock per location */}
        <GlassCard className="animate-glass-in lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-base text-white">
              <Warehouse className="h-4 w-4 text-warn-500" />
              Distribusi Stok per Lokasi
            </CardTitle>
            <p className="mt-0.5 text-xs text-ink-300">5 lokasi dengan stok terbesar</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.locStock.length === 0 && (
              <p className="py-8 text-center text-sm text-ink-300">Belum ada stok tercatat.</p>
            )}
            {data.locStock.map((l) => (
              <div key={l.code}>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <p className="text-sm font-medium text-white">
                    <span className="tnum font-mono text-warn-500">{l.code}</span>
                    <span className="ml-2 text-ink-300">{l.name}</span>
                  </p>
                  <p className="tnum font-mono text-sm text-white">
                    {l.qty.toLocaleString("id-ID")}
                  </p>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-warn-500 to-brand-600 transition-all"
                    style={{ width: `${Math.max(4, (l.qty / maxLoc) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </GlassCard>

        {/* Asset status donut */}
        <GlassCard className="animate-glass-in" style={{ animationDelay: "90ms" }}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-base text-white">
              <Package className="h-4 w-4 text-warn-500" />
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
                  contentStyle={DARK_TOOLTIP}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="mt-2 space-y-1.5">
              {data.byStatus.map((s) => (
                <div key={s.status} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-ink-200">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: STATUS_COLORS[s.status] }}
                    />
                    {s.label}
                  </span>
                  <span className="tnum font-mono text-white">
                    {s.count.toLocaleString("id-ID")}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </GlassCard>
      </div>
    </div>
    </div>
  );
}
