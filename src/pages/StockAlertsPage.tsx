import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, Siren } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { PageHeader } from "../components/PageHeader";
import { Card, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { DataTable } from "../components/DataTable";
import { exportToCsv } from "../lib/csv";

type AlertLevel = "kritis" | "waspada";

interface AlertRow {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  totalStock: number;
  minStock: number;
  level: AlertLevel;
  locations: string;
}

const fmt = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 3 });

const alertColumns: ColumnDef<AlertRow, unknown>[] = [
  { header: "SKU", accessorKey: "sku" },
  {
    header: "Barang",
    accessorKey: "name",
    cell: ({ row }) => (
      <div>
        <div className="font-medium">{row.original.name}</div>
        {row.original.brand && (
          <div className="text-xs text-ink-500">{row.original.brand}</div>
        )}
      </div>
    ),
  },
  { header: "Lokasi", accessorKey: "locations" },
  {
    header: "Total Stok",
    accessorKey: "totalStock",
    cell: ({ row }) => <span className="tnum text-right">{fmt(row.original.totalStock)}</span>,
  },
  {
    header: "Stok Min",
    accessorKey: "minStock",
    cell: ({ row }) => <span className="tnum text-right">{fmt(row.original.minStock)}</span>,
  },
  {
    header: "Status",
    accessorKey: "level",
    cell: ({ row }) =>
      row.original.level === "kritis" ? (
        <Badge variant="destructive">Kritis</Badge>
      ) : (
        <Badge variant="warning">Waspada</Badge>
      ),
  },
];

export function StockAlertsPage() {
  const [rows, setRows] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [itemsRes, balRes, locRes] = await Promise.all([
          supabase
            .from("inventory_items")
            .select("id, sku, name, brand, min_stock")
            .eq("is_active", true)
            .gt("min_stock", 0)
            .order("name")
            .limit(2000),
          supabase.from("inventory_balances").select("item_id, location_id, qty"),
          supabase.from("locations").select("id, name, warehouses(name)"),
        ]);
        if (cancelled) return;
        if (itemsRes.error) throw new Error(itemsRes.error.message);
        if (balRes.error) throw new Error(balRes.error.message);
        if (locRes.error) throw new Error(locRes.error.message);

        const items = (itemsRes.data ?? []) as {
          id: string;
          sku: string;
          name: string;
          brand: string | null;
          min_stock: number;
        }[];
        const balances = (balRes.data ?? []) as {
          item_id: string;
          location_id: string;
          qty: number | string;
        }[];
        const locName = new Map<string, string>();
        for (const l of (locRes.data ?? []) as {
          id: string;
          name: string;
          warehouses: { name: string }[] | null;
        }[])
          locName.set(l.id, l.warehouses?.[0] ? `${l.warehouses[0].name} — ${l.name}` : l.name);

        const byItem = new Map<string, { qty: number; locs: Set<string> }>();
        for (const b of balances) {
          let e = byItem.get(b.item_id);
          if (!e) {
            e = { qty: 0, locs: new Set() };
            byItem.set(b.item_id, e);
          }
          const q = Number(b.qty);
          if (q > 0) {
            e.qty += q;
            const ln = locName.get(b.location_id);
            if (ln) e.locs.add(ln);
          }
        }

        const alerts: AlertRow[] = [];
        for (const it of items) {
          const e = byItem.get(it.id);
          const total = e?.qty ?? 0;
          const min = Number(it.min_stock);
          let level: AlertLevel | null = null;
          if (total <= min) level = "kritis";
          else if (total <= min * 2) level = "waspada";
          if (!level) continue;
          alerts.push({
            id: it.id,
            sku: it.sku,
            name: it.name,
            brand: it.brand,
            totalStock: total,
            minStock: min,
            level,
            locations: e && e.locs.size > 0 ? [...e.locs].join(", ") : "—",
          });
        }
        // Kritis dulu, lalu waspada; dalam grup urut stok terkecil.
        alerts.sort((a, b) =>
          a.level === b.level
            ? a.totalStock - b.totalStock
            : a.level === "kritis"
              ? -1
              : 1
        );
        setRows(alerts);
      } catch (err) {
        if (!cancelled)
          toast.error(err instanceof Error ? err.message : "Gagal memuat peringatan stok.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(() => {
    let kritis = 0;
    let waspada = 0;
    for (const r of rows) {
      if (r.level === "kritis") kritis++;
      else waspada++;
    }
    return { kritis, waspada };
  }, [rows]);

  const handleExport = () => {
    if (rows.length === 0) {
      toast.error("Tidak ada data untuk diekspor.");
      return;
    }
    exportToCsv(
      "peringatan-stok",
      rows.map((r) => ({
        SKU: r.sku,
        Barang: r.name,
        Merek: r.brand ?? "",
        Lokasi: r.locations,
        "Total Stok": r.totalStock,
        "Stok Min": r.minStock,
        Status: r.level === "kritis" ? "Kritis" : "Waspada",
      }))
    );
  };

  return (
    <div>
      <PageHeader
        title="Peringatan Stok"
        description="Barang dengan stok kritis (≤ stok minimum) dan waspada (≤ 2× stok minimum)."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="rounded-xl bg-brand-50 p-2.5 text-brand-600 ring-1 ring-brand-200">
              <Siren className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-ink-500">
                Kritis
              </p>
              <p className="tnum font-display text-2xl font-bold text-ink-800">
                {counts.kritis.toLocaleString("id-ID")}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="rounded-xl bg-warn-50 p-2.5 text-warn-600 ring-1 ring-warn-100">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-ink-500">
                Waspada
              </p>
              <p className="tnum font-display text-2xl font-bold text-ink-800">
                {counts.waspada.toLocaleString("id-ID")}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 flex justify-end">
        <Button variant="outline" onClick={handleExport} disabled={rows.length === 0}>
          Export CSV
        </Button>
      </div>

      <div className="mt-4">
        <DataTable<AlertRow>
          columns={alertColumns}
          data={rows}
          loading={loading}
          searchPlaceholder="Cari barang…"
          pageSize={15}
          emptyTitle="Tidak ada peringatan"
          emptyDescription="Semua barang berada di atas ambang waspada."
        />
      </div>
    </div>
  );
}
