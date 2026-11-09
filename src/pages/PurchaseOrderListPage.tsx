import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { badgeDarkClass, poStatusVariant } from "../lib/statusColors";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { DataTable } from "../components/DataTable";

export type PoStatus = "draft" | "ordered" | "received_partial" | "received" | "cancelled";

/** Tombol outline di atas kaca gelap (ganti bawaan putih). */
const DARK_OUTLINE_BTN =
  "border-white/20 bg-white/10 text-white hover:border-white/25 hover:bg-white/15 hover:text-white";

export const PO_STATUS_LABELS: Record<PoStatus, string> = {
  draft: "Draft",
  ordered: "Dipesan",
  received_partial: "Diterima Sebagian",
  received: "Diterima Penuh",
  cancelled: "Dibatalkan",
};

const fmtRp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

interface PoRow {
  id: string;
  po_number: string;
  supplier: { name: string } | { name: string }[] | null;
  status: PoStatus;
  order_date: string;
  expected_date: string | null;
  total_amount: number;
  itemCount: number;
}

const poColumns: ColumnDef<PoRow, unknown>[] = [
  {
    header: "No. PO",
    accessorKey: "po_number",
    cell: ({ row }) => (
      <Link to={`/pembelian/${row.original.id}`} className="font-mono font-semibold text-brand-200 hover:underline">
        {row.original.po_number}
      </Link>
    ),
  },
  {
    header: "Supplier",
    accessorKey: "supplier",
    cell: ({ row }) => {
      const s = row.original.supplier;
      const name = Array.isArray(s) ? s[0]?.name : s?.name;
      return <span>{name ?? "—"}</span>;
    },
  },
  {
    header: "Status",
    accessorKey: "status",
    cell: ({ row }) => (
      <Badge variant={poStatusVariant[row.original.status]} className={badgeDarkClass[poStatusVariant[row.original.status]]}>{PO_STATUS_LABELS[row.original.status]}</Badge>
    ),
  },
  {
    header: "Tgl Pesan",
    accessorKey: "order_date",
    cell: ({ row }) =>
      new Date(row.original.order_date).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }),
  },
  {
    header: "Estimasi Datang",
    accessorKey: "expected_date",
    cell: ({ row }) =>
      row.original.expected_date
        ? new Date(row.original.expected_date).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })
        : "—",
  },
  {
    header: "Item",
    accessorKey: "itemCount",
    cell: ({ row }) => <span className="tnum">{row.original.itemCount}</span>,
  },
  {
    header: "Total",
    accessorKey: "total_amount",
    cell: ({ row }) => <span className="tnum font-semibold">{fmtRp(Number(row.original.total_amount))}</span>,
  },
];

type Tab = "semua" | "draft" | "ordered" | "received_partial" | "received" | "cancelled";

const TABS: { id: Tab; label: string }[] = [
  { id: "semua", label: "Semua" },
  { id: "draft", label: "Draft" },
  { id: "ordered", label: "Dipesan" },
  { id: "received_partial", label: "Diterima Sebagian" },
  { id: "received", label: "Diterima Penuh" },
  { id: "cancelled", label: "Dibatalkan" },
];

export function PurchaseOrderListPage() {
  const [rows, setRows] = useState<PoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("semua");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("purchase_orders")
          .select("id, po_number, status, order_date, expected_date, total_amount, suppliers(name), purchase_order_items(id)")
          .order("created_at", { ascending: false })
          .limit(500);
        if (error) throw new Error(error.message);
        if (cancelled) return;
        const mapped: PoRow[] = ((data ?? []) as unknown as {
          id: string;
          po_number: string;
          status: PoStatus;
          order_date: string;
          expected_date: string | null;
          total_amount: number | string;
          suppliers: { name: string } | { name: string }[] | null;
          purchase_order_items: { id: string }[];
        }[]).map((p) => ({
          id: p.id,
          po_number: p.po_number,
          supplier: p.suppliers,
          status: p.status,
          order_date: p.order_date,
          expected_date: p.expected_date,
          total_amount: Number(p.total_amount),
          itemCount: p.purchase_order_items?.length ?? 0,
        }));
        setRows(mapped);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Gagal memuat PO");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(
    () => (tab === "semua" ? rows : rows.filter((r) => r.status === tab)),
    [rows, tab]
  );

  return (
    <div>
      <PageHeader
        title="Purchase Order"
        description="Pesanan pembelian ke supplier — buat PO, kirim ke supplier, terima barang masuk gudang."
        actions={
          <Link to="/pembelian/baru">
            <Button>
              <Plus className="mr-2 h-4 w-4" /> Buat PO
            </Button>
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <Button
            key={t.id}
            variant={tab === t.id ? "default" : "outline"}
            size="sm"
            className={tab === t.id ? undefined : DARK_OUTLINE_BTN}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id !== "semua" && (
              <span className="ml-1.5 rounded-full bg-white/20 px-1.5 text-[11px]">
                {rows.filter((r) => r.status === t.id).length}
              </span>
            )}
          </Button>
        ))}
      </div>

      <DataTable<PoRow>
        columns={poColumns}
        data={filtered}
        loading={loading}
        searchPlaceholder="Cari No. PO / supplier…"
        pageSize={15}
        emptyTitle="Belum ada Purchase Order"
        emptyDescription="Klik “Buat PO” untuk memesan barang ke supplier."
      />
    </div>
  );
}
