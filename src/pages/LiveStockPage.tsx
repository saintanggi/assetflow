import { useEffect, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select } from "../components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { DataTable } from "../components/DataTable";
import { exportToCsv } from "../lib/csv";

interface WarehouseOption {
  value: string;
  label: string;
}

interface LiveStockRow {
  sku: string;
  item: string;
  location: string;
  stokAwal: number;
  inQty: number;
  outQty: number;
  stokAkhir: number;
}

function firstOfMonth(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
}

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const fmt = (n: number) =>
  n.toLocaleString("id-ID", { maximumFractionDigits: 3 });

const right = "text-right";
const liveStockColumns: ColumnDef<LiveStockRow, unknown>[] = [
  { header: "SKU", accessorKey: "sku" },
  { header: "Item", accessorKey: "item" },
  { header: "Lokasi", accessorKey: "location" },
  {
    header: "Stok Awal",
    accessorKey: "stokAwal",
    cell: ({ row }) => <span className={right}>{fmt(row.original.stokAwal)}</span>,
  },
  {
    header: "IN",
    accessorKey: "inQty",
    cell: ({ row }) => <span className={right}>{fmt(row.original.inQty)}</span>,
  },
  {
    header: "OUT",
    accessorKey: "outQty",
    cell: ({ row }) => <span className={right}>{fmt(row.original.outQty)}</span>,
  },
  {
    header: "Stok Akhir",
    accessorKey: "stokAkhir",
    cell: ({ row }) => (
      <span className={`${right} font-medium`}>{fmt(row.original.stokAkhir)}</span>
    ),
  },
];

export function LiveStockPage() {
  const [warehouseId, setWarehouseId] = useState("");
  const [startDate, setStartDate] = useState(firstOfMonth);
  const [endDate, setEndDate] = useState(todayLocal);
  const [warehouseOptions, setWarehouseOptions] = useState<WarehouseOption[]>([]);
  const [rows, setRows] = useState<LiveStockRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("warehouses")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (cancelled) return;
      if (error) {
        toast.error(`Gagal memuat gudang: ${error.message}`);
        return;
      }
      const opts = ((data ?? []) as { id: string; name: string }[]).map((w) => ({
        value: w.id,
        label: w.name,
      }));
      setWarehouseOptions(opts);
      if (opts.length > 0) setWarehouseId(opts[0].value);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadReport = async () => {
    if (!warehouseId) {
      toast.error("Pilih gudang dulu.");
      return;
    }
    if (startDate > endDate) {
      toast.error("Tanggal awal tidak boleh setelah tanggal akhir.");
      return;
    }
    setLoading(true);
    try {
      // Lokasi-lokasi gudang ini.
      const { data: locData, error: locErr } = await supabase
        .from("locations")
        .select("id, name")
        .eq("warehouse_id", warehouseId)
        .eq("is_active", true);
      if (locErr) throw new Error(locErr.message);
      const locs = (locData ?? []) as { id: string; name: string }[];
      if (locs.length === 0) {
        setRows([]);
        setSearched(true);
        return;
      }
      const locIds = locs.map((l) => l.id);
      const locName = new Map(locs.map((l) => [l.id, l.name]));

      // Saldo saat ini per (item, lokasi).
      const { data: balData, error: balErr } = await supabase
        .from("inventory_balances")
        .select("item_id, location_id, qty")
        .in("location_id", locIds);
      if (balErr) throw new Error(balErr.message);

      // Mutasi dalam periode dari ledger (paginasi per 1.000 baris agar tidak terpotong batas PostgREST).
      const ledData: {
        item_id: string;
        location_id: string;
        qty_change: number | string;
      }[] = [];
      const pageSize = 1000;
      let offset = 0;
      while (true) {
        const { data: ledBatch, error: ledErr } = await supabase
          .from("inventory_ledger")
          .select("item_id, location_id, qty_change")
          .in("location_id", locIds)
          .gte("created_at", `${startDate}T00:00:00`)
          .lte("created_at", `${endDate}T23:59:59`)
          .order("id", { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (ledErr) throw new Error(ledErr.message);
        const batch = (ledBatch ?? []) as {
          item_id: string;
          location_id: string;
          qty_change: number | string;
        }[];
        ledData.push(...batch);
        if (batch.length < pageSize) break;
        offset += pageSize;
      }

      type Agg = { inQty: number; outQty: number };
      const move = new Map<string, Agg>(); // key: item_id|location_id
      for (const r of (ledData ?? []) as {
        item_id: string;
        location_id: string;
        qty_change: number | string;
      }[]) {
        const key = `${r.item_id}|${r.location_id}`;
        const q = Number(r.qty_change);
        let a = move.get(key);
        if (!a) {
          a = { inQty: 0, outQty: 0 };
          move.set(key, a);
        }
        if (q > 0) a.inQty += q;
        else a.outQty += -q;
      }

      // Kumpulkan semua pasangan (item, lokasi) dari saldo & mutasi.
      const keys = new Set<string>();
      for (const b of (balData ?? []) as {
        item_id: string;
        location_id: string;
      }[])
        keys.add(`${b.item_id}|${b.location_id}`);
      for (const k of move.keys()) keys.add(k);

      const balMap = new Map<string, number>();
      for (const b of (balData ?? []) as {
        item_id: string;
        location_id: string;
        qty: number | string;
      }[])
        balMap.set(`${b.item_id}|${b.location_id}`, Number(b.qty));

      // Nama & SKU item.
      const itemIds = [...new Set([...keys].map((k) => k.split("|")[0]))];
      const itemMap = new Map<string, { sku: string; name: string }>();
      for (let i = 0; i < itemIds.length; i += 100) {
        const chunk = itemIds.slice(i, i + 100);
        const { data, error } = await supabase
          .from("inventory_items")
          .select("id, sku, name")
          .in("id", chunk);
        if (error) throw new Error(error.message);
        for (const it of (data ?? []) as { id: string; sku: string; name: string }[])
          itemMap.set(it.id, { sku: it.sku, name: it.name });
      }

      const result: LiveStockRow[] = [];
      for (const key of keys) {
        const [itemId, locId] = key.split("|");
        const akhir = balMap.get(key) ?? 0;
        const m = move.get(key) ?? { inQty: 0, outQty: 0 };
        const awal = akhir - m.inQty + m.outQty;
        // Lewati baris yang sepenuhnya nol agar laporan ringkas.
        if (awal === 0 && m.inQty === 0 && m.outQty === 0 && akhir === 0) continue;
        const info = itemMap.get(itemId) ?? { sku: "-", name: "(item dihapus)" };
        result.push({
          sku: info.sku,
          item: info.name,
          location: locName.get(locId) ?? "-",
          stokAwal: awal,
          inQty: m.inQty,
          outQty: m.outQty,
          stokAkhir: akhir,
        });
      }
      result.sort((a, b) => a.item.localeCompare(b.item, "id"));
      setRows(result);
      setSearched(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal memuat laporan.");
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = () => {
    if (rows.length === 0) {
      toast.error("Tidak ada data untuk diekspor.");
      return;
    }
    exportToCsv(
      `live-stok-${startDate}_${endDate}`,
      rows.map((r) => ({
        SKU: r.sku,
        Item: r.item,
        Lokasi: r.location,
        "Stok Awal": r.stokAwal,
        IN: r.inQty,
        OUT: r.outQty,
        "Stok Akhir": r.stokAkhir,
      }))
    );
  };

  return (
    <div>
      <PageHeader
        title="Live Stok"
        description="Posisi stok per gudang ala Excel LIVE STOK: Stok Awal / IN / OUT / Stok Akhir."
      />
      <Card>
        <CardHeader>
          <CardTitle>Filter Laporan</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="ls-wh">Gudang</Label>
              <Select
                id="ls-wh"
                options={warehouseOptions}
                placeholder="Pilih gudang"
                value={warehouseId}
                onValueChange={setWarehouseId}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ls-start">Dari Tanggal</Label>
              <Input
                id="ls-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ls-end">Sampai Tanggal</Label>
              <Input
                id="ls-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={loadReport} disabled={loading}>
                {loading ? "Memuat…" : "Tampilkan"}
              </Button>
              <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
                Export CSV
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="mt-6">
        <DataTable<LiveStockRow>
          columns={liveStockColumns}
          data={rows}
          loading={loading}
          emptyTitle={searched ? "Tidak ada data" : "Belum ada laporan"}
          emptyDescription={
            searched
              ? "Tidak ada pergerakan/saldo pada periode ini."
              : "Atur filter lalu klik Tampilkan."
          }
        />
      </div>
    </div>
  );
}
