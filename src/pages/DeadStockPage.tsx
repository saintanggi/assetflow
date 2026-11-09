import { useEffect, useMemo, useState } from "react";
import type { HTMLAttributes } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Clock, PackageX } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { badgeDarkClass } from "../lib/statusColors";
import { cn } from "../lib/utils";
import { PageHeader } from "../components/PageHeader";
import { CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { DataTable } from "../components/DataTable";
import { exportToCsv } from "../lib/csv";

const fmt = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 3 });
const fmtRp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

/** Permukaan kaca gelap — sama seperti dashboard. */
function GlassCard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/15 bg-white/[0.07] shadow-[0_8px_32px_rgba(2,6,23,0.35)] backdrop-blur-xl transition-all duration-300 hover:border-white/25 hover:bg-white/[0.09]",
        className
      )}
      {...props}
    />
  );
}

/** Tombol outline di atas kaca gelap (ganti bawaan putih). */
const DARK_OUTLINE_BTN =
  "border-white/20 bg-white/10 text-white hover:border-white/25 hover:bg-white/15 hover:text-white";


interface DeadRow {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  totalStock: number;
  purchasePrice: number;
  value: number;
  lastOut: string | null;
  daysIdle: number | null;
}

const deadColumns: ColumnDef<DeadRow, unknown>[] = [
  { header: "SKU", accessorKey: "sku" },
  {
    header: "Barang",
    accessorKey: "name",
    cell: ({ row }) => (
      <div>
        <div className="font-medium">{row.original.name}</div>
        {row.original.brand && <div className="text-xs text-ink-300">{row.original.brand}</div>}
      </div>
    ),
  },
  {
    header: "Stok",
    accessorKey: "totalStock",
    cell: ({ row }) => <span className="tnum font-semibold">{fmt(row.original.totalStock)}</span>,
  },
  {
    header: "Nilai Stok",
    accessorKey: "value",
    cell: ({ row }) => <span className="tnum">{fmtRp(row.original.value)}</span>,
  },
  {
    header: "Terakhir Keluar",
    accessorKey: "lastOut",
    cell: ({ row }) => (
      <span className="text-sm">
        {row.original.lastOut
          ? new Date(row.original.lastOut).toLocaleDateString("id-ID", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })
          : "Belum pernah keluar"}
      </span>
    ),
  },
  {
    header: "Tidak Bergerak",
    accessorKey: "daysIdle",
    cell: ({ row }) => (
      <Badge
        variant={row.original.daysIdle !== null && row.original.daysIdle >= 180 ? "destructive" : "secondary"}
        className={badgeDarkClass[row.original.daysIdle !== null && row.original.daysIdle >= 180 ? "destructive" : "secondary"]}
      >
        {row.original.daysIdle !== null ? `${row.original.daysIdle} hari` : "—"}
      </Badge>
    ),
  },
];

const IDLE_DAYS = 90;

export function DeadStockPage() {
  const [rows, setRows] = useState<DeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [threshold, setThreshold] = useState(IDLE_DAYS);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [itemsRes, balancesRes, ledgerRes] = await Promise.all([
          supabase
            .from("inventory_items")
            .select("id, sku, name, brand, purchase_price")
            .eq("is_active", true),
          supabase.from("inventory_balances").select("item_id, qty"),
          // Pergerakan keluar (qty_change < 0) — cari tanggal terakhir per item.
          supabase
            .from("inventory_ledger")
            .select("item_id, created_at")
            .lt("qty_change", 0)
            .order("created_at", { ascending: false })
            .limit(10000),
        ]);
        if (cancelled) return;
        const failures = [itemsRes, balancesRes, ledgerRes].filter((r) => r.error);
        if (failures.length > 0) throw new Error("Gagal memuat data dead stock");

        const items = (itemsRes.data ?? []) as {
          id: string;
          sku: string;
          name: string;
          brand: string | null;
          purchase_price: number | null;
        }[];
        const balances = (balancesRes.data ?? []) as { item_id: string; qty: number | string }[];
        const ledger = (ledgerRes.data ?? []) as { item_id: string; created_at: string }[];

        const stockByItem = new Map<string, number>();
        for (const b of balances) {
          stockByItem.set(b.item_id, (stockByItem.get(b.item_id) ?? 0) + Number(b.qty));
        }
        // Tanggal keluar terakhir per item (ledger sudah urut terbaru dulu).
        const lastOutByItem = new Map<string, string>();
        for (const l of ledger) {
          if (!lastOutByItem.has(l.item_id)) lastOutByItem.set(l.item_id, l.created_at);
        }

        const now = Date.now();
        const mapped: DeadRow[] = items
          .map((item) => {
            const totalStock = stockByItem.get(item.id) ?? 0;
            const lastOut = lastOutByItem.get(item.id) ?? null;
            const daysIdle = lastOut
              ? Math.floor((now - new Date(lastOut).getTime()) / (1000 * 60 * 60 * 24))
              : null;
            return {
              id: item.id,
              sku: item.sku,
              name: item.name,
              brand: item.brand,
              totalStock,
              purchasePrice: Number(item.purchase_price ?? 0),
              value: totalStock * Number(item.purchase_price ?? 0),
              lastOut,
              daysIdle,
            };
          })
          // Hanya yang berstok & tidak bergerak >= threshold (atau belum pernah keluar).
          .filter((r) => r.totalStock > 0 && (r.daysIdle === null || r.daysIdle >= threshold))
          .sort((a, b) => (b.daysIdle ?? 9999) - (a.daysIdle ?? 9999));
        setRows(mapped);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Gagal memuat data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [threshold]);

  const totalValue = useMemo(() => rows.reduce((s, r) => s + r.value, 0), [rows]);
  const totalUnits = useMemo(() => rows.reduce((s, r) => s + r.totalStock, 0), [rows]);

  const exportCsv = () => {
    if (rows.length === 0) {
      toast.error("Tidak ada data dead stock untuk diekspor.");
      return;
    }
    exportToCsv(
      `dead-stock-${new Date().toISOString().slice(0, 10)}.csv`,
      rows.map((r) => ({
        SKU: r.sku,
        "NAMA BARANG": r.name,
        MEREK: r.brand ?? "",
        STOK: r.totalStock,
        "HARGA BELI": r.purchasePrice,
        "NILAI STOK": r.value,
        "TERAKHIR KELUAR": r.lastOut ?? "Belum pernah keluar",
        "TIDAK BERGERAK (HARI)": r.daysIdle !== null ? r.daysIdle : "",
      }))
    );
  };

  return (
    <div>
      <PageHeader
        title="Barang Slow-Moving / Dead Stock"
        description={`Barang berstok yang tidak keluar selama ${threshold} hari atau lebih — modal gudang yang mengendap.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="h-9 rounded-lg border border-white/15 bg-white/10 px-2 text-sm text-white [color-scheme:dark]"
            >
              <option value={30} className="bg-ink-800 text-white">Tidak bergerak ≥ 30 hari</option>
              <option value={60} className="bg-ink-800 text-white">Tidak bergerak ≥ 60 hari</option>
              <option value={90} className="bg-ink-800 text-white">Tidak bergerak ≥ 90 hari</option>
              <option value={180} className="bg-ink-800 text-white">Tidak bergerak ≥ 180 hari</option>
            </select>
            <Button variant="outline" size="sm" className={DARK_OUTLINE_BTN} onClick={exportCsv}>
              Export CSV
            </Button>
          </div>
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <GlassCard>
          <CardContent className="p-5">
            <p className="text-xs font-medium uppercase tracking-widest text-ink-300">Item Dead Stock</p>
            <p className="tnum mt-2 text-3xl font-bold text-white">{rows.length.toLocaleString("id-ID")}</p>
          </CardContent>
        </GlassCard>
        <GlassCard>
          <CardContent className="p-5">
            <p className="text-xs font-medium uppercase tracking-widest text-ink-300">Total Unit Mengendap</p>
            <p className="tnum mt-2 text-3xl font-bold text-white">{fmt(totalUnits)}</p>
          </CardContent>
        </GlassCard>
        <GlassCard>
          <CardContent className="p-5">
            <p className="text-xs font-medium uppercase tracking-widest text-ink-300">Nilai Modal Mengendap</p>
            <p className="tnum mt-2 text-3xl font-bold text-white">{fmtRp(totalValue)}</p>
          </CardContent>
        </GlassCard>
      </div>

      <DataTable<DeadRow>
        columns={deadColumns}
        data={rows}
        loading={loading}
        searchPlaceholder="Cari nama barang / SKU…"
        pageSize={15}
        emptyTitle="Tidak ada dead stock"
        emptyDescription={`Tidak ada barang berstok yang tidak bergerak selama ${threshold} hari.`}
      />

      {rows.length > 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-300">
          <Clock className="h-3.5 w-3.5" />
          Pertimbangkan: obral / pindahkan ke cabang lain / jangan restock dulu.
          <PackageX className="ml-2 h-3.5 w-3.5" />
        </p>
      )}
    </div>
  );
}
