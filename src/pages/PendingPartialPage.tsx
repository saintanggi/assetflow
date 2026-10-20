import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import * as XLSX from "xlsx";
import { Download, Hourglass } from "lucide-react";
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
  jenis: "Belum Terkirim" | "Menunggu Stok";
  keterangan: string | null;
}

const fmt = (n: number) => Number(n).toLocaleString("id-ID", { maximumFractionDigits: 3 });

const columns: ColumnDef<PendingRow, unknown>[] = [
  {
    header: "No. Permintaan",
    accessorKey: "request_number",
    cell: ({ row }) => (
      <Link
        to={`/permintaan/${row.original.request_id}`}
        className="font-mono text-sm text-brand-700 hover:underline"
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
        <div className="font-mono text-xs text-ink-500">{row.original.sku}</div>
      </div>
    ),
  },
  {
    header: "Jenis",
    accessorKey: "jenis",
    cell: ({ row }) => (
      <span
        className={`rounded-full px-2 py-0.5 text-xs ${
          row.original.jenis === "Menunggu Stok"
            ? "bg-info-100 text-info-600"
            : "bg-warn-100 text-warn-600"
        }`}
      >
        {row.original.jenis}
      </span>
    ),
  },
  {
    header: "Sisa Belum Terkirim",
    accessorKey: "sisa",
    cell: ({ row }) => (
      <span className="tnum font-semibold text-warn-600">{fmt(row.original.sisa)}</span>
    ),
  },
  {
    header: "Keterangan Gudang",
    accessorKey: "keterangan",
    cell: ({ row }) => (
      <span className="text-xs text-ink-500">{row.original.keterangan ?? "—"}</span>
    ),
  },
  {
    header: "Minta / Setuju / Kirim",
    accessorKey: "qty_requested",
    cell: ({ row }) => (
      <span className="tnum text-xs text-ink-500">
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
          {row.original.jenis === "Menunggu Stok" ? "Setujui" : "Kirim Susulan"}
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
          "id, request_id, qty_requested, qty_approved, qty_shipped, resi, item_status, notes, inventory_items(sku, name), requests(request_number, branch_name)"
        )
        .in("item_status", ["pending_sebagian", "menunggu_stok"])
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
          qty_approved: number | string | null;
          qty_shipped: number | string;
          resi: string | null;
          item_status: string;
          notes: string | null;
          inventory_items: { sku: string; name: string } | { sku: string; name: string }[] | null;
          requests: { request_number: string; branch_name: string } | { request_number: string; branch_name: string }[] | null;
        }[])
          .map((x) => {
            const isMenungguStok = x.item_status === "menunggu_stok";
            const approved = Number(x.qty_approved ?? 0);
            const shipped = Number(x.qty_shipped ?? 0);
            const requested = Number(x.qty_requested ?? 0);
            return {
              id: x.id,
              request_id: x.request_id,
              request_number: one(x.requests)?.request_number ?? "—",
              branch_name: one(x.requests)?.branch_name ?? "—",
              sku: one(x.inventory_items)?.sku ?? "—",
              name: one(x.inventory_items)?.name ?? "—",
              qty_requested: requested,
              qty_approved: approved,
              qty_shipped: shipped,
              sisa: isMenungguStok ? requested : approved - shipped,
              resi: x.resi,
              jenis: (isMenungguStok ? "Menunggu Stok" : "Belum Terkirim") as PendingRow["jenis"],
              keterangan: x.notes,
            };
          })
          .filter((x) => x.sisa > 0);
        setRows(mapped);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const exportExcel = () => {
    if (rows.length === 0) {
      toast.error("Tidak ada data sisa pending untuk diekspor.");
      return;
    }
    const headers = [
      "NO. PERMINTAAN",
      "CABANG / GERAI",
      "KODE BARANG",
      "NAMA BARANG",
      "JENIS PENDING",
      "SISA BELUM TERKIRIM",
      "QTY DIMINTA",
      "QTY DISETUJUI",
      "QTY TERKIRIM",
      "RESI",
      "KETERANGAN GUDANG",
    ];
    const sheetRows = [
      headers,
      ...rows.map((r) => [
        r.request_number,
        r.branch_name,
        r.sku,
        r.name,
        r.jenis,
        r.sisa,
        r.qty_requested,
        r.qty_approved,
        r.qty_shipped,
        r.resi ?? "",
        r.keterangan ?? "",
      ]),
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheetRows), "SISA_PENDING");
    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `Sisa_Belum_Terkirim_${today}.xlsx`);
    toast.success("File Excel Sisa Belum Terkirim berhasil diunduh.");
  };

  return (
    <div>
      <PageHeader
        title="Sisa Belum Terkirim"
        description="Barang dengan sisa yang belum terpenuhi — menunggu stok atau kiriman susulan."
        actions={
          <Button variant="outline" onClick={exportExcel} disabled={loading || rows.length === 0}>
            <Download className="mr-1 h-4 w-4" /> Export Excel
          </Button>
        }
      />

      <Card className="mb-4">
        <CardContent className="flex items-center gap-4 p-5">
          <div className="rounded-xl bg-warn-50 p-2.5 text-warn-600 ring-1 ring-warn-100">
            <Hourglass className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-ink-500">
              Item menunggu stok / kiriman susulan
            </p>
            <p className="tnum font-display text-2xl font-bold text-ink-800">
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
        emptyDescription="Tidak ada item yang menunggu stok atau kiriman susulan."
      />
    </div>
  );
}
