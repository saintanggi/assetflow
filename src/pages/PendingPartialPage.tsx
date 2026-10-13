import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { Hourglass } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { PageHeader } from "../components/PageHeader";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { DataTable } from "../components/DataTable";

interface PendingRow {
  id: string;
  request_id: string;
  request_number: string;
  branch_name: string;
  sku: string;
  name: string;
  qty_requested: number;
  qty_approved: number;
  qty_shipped: number;
  sisa: number;
  resi: string | null;
}

const fmt = (n: number) => Number(n).toLocaleString("id-ID", { maximumFractionDigits: 3 });

const columns: ColumnDef<PendingRow, unknown>[] = [
  {
    header: "No. Permintaan",
    accessorKey: "request_number",
    cell: ({ row }) => (
      <Link
        to={`/permintaan/${row.original.request_id}`}
        className="font-mono text-sm text-brand-300 hover:underline"
      >
        {row.original.request_number}
      </Link>
    ),
  },
  { header: "Cabang / Gerai", accessorKey: "branch_name" },
  {
    header: "Barang",
    accessorKey: "name",
    cell: ({ row }) => (
      <div>
        <div className="font-medium">{row.original.name}</div>
        <div className="font-mono text-xs text-slate-500">{row.original.sku}</div>
      </div>
    ),
  },
  {
    header: "Sisa Belum Terkirim",
    accessorKey: "sisa",
    cell: ({ row }) => (
      <span className="tnum font-semibold text-amber-300">{fmt(row.original.sisa)}</span>
    ),
  },
  {
    header: "Minta / Setuju / Kirim",
    accessorKey: "qty_requested",
    cell: ({ row }) => (
      <span className="tnum text-xs text-slate-400">
        {fmt(row.original.qty_requested)} / {fmt(row.original.qty_approved)} /{" "}
        {fmt(row.original.qty_shipped)}
      </span>
    ),
  },
  {
    header: "Aksi",
    accessorKey: "id",
    cell: ({ row }) => (
      <Link to={`/permintaan/${row.original.request_id}`}>
        <Button size="sm" variant="outline">
          Kirim Susulan
        </Button>
      </Link>
    ),
  },
];

export function PendingPartialPage() {
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("request_items")
        .select(
          "id, request_id, qty_requested, qty_approved, qty_shipped, resi, item_status, inventory_items(sku, name), requests(request_number, branch_name)"
        )
        .eq("item_status", "pending_sebagian")
        .order("updated_at", { ascending: false })
        .limit(500);
      if (cancelled) return;
      if (error) {
        toast.error(error.message);
      } else {
        const one = <T,>(v: T | T[] | null): T | null =>
          Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
        const mapped = ((data ?? []) as unknown as {
          id: string;
          request_id: string;
          qty_requested: number | string;
          qty_approved: number | string;
          qty_shipped: number | string;
          resi: string | null;
          inventory_items: { sku: string; name: string } | { sku: string; name: string }[] | null;
          requests: { request_number: string; branch_name: string } | { request_number: string; branch_name: string }[] | null;
        }[])
          .map((x) => ({
            id: x.id,
            request_id: x.request_id,
            request_number: one(x.requests)?.request_number ?? "—",
            branch_name: one(x.requests)?.branch_name ?? "—",
            sku: one(x.inventory_items)?.sku ?? "—",
            name: one(x.inventory_items)?.name ?? "—",
            qty_requested: Number(x.qty_requested),
            qty_approved: Number(x.qty_approved),
            qty_shipped: Number(x.qty_shipped),
            sisa: Number(x.qty_approved) - Number(x.qty_shipped),
            resi: x.resi,
          }))
          .filter((x) => x.sisa > 0);
        setRows(mapped);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <PageHeader
        title="Sisa Belum Terkirim"
        description="Barang yang disetujui sebagian — kirim susulan begitu stok restock."
      />

      <Card className="mb-4">
        <CardContent className="flex items-center gap-4 p-5">
          <div className="rounded-xl bg-amber-400/10 p-2.5 text-amber-300 ring-1 ring-amber-400/20">
            <Hourglass className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-slate-500">
              Item menunggu kiriman susulan
            </p>
            <p className="tnum font-display text-2xl font-bold text-white">
              {rows.length.toLocaleString("id-ID")}
            </p>
          </div>
        </CardContent>
      </Card>

      <DataTable<PendingRow>
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Cari permintaan / barang / gerai…"
        pageSize={15}
        emptyTitle="Tidak ada sisa pending"
        emptyDescription="Semua barang yang disetujui sudah terkirim penuh."
      />
    </div>
  );
}
