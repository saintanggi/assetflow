import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { DataTable } from "../components/DataTable";
import {
  REQUEST_STATUS_LABELS,
  type Request,
  type RequestStatus,
} from "../types/database";

const STATUS_VARIANT: Record<RequestStatus, "default" | "info" | "warning" | "success" | "destructive" | "secondary"> = {
  diajukan: "info",
  disetujui: "success",
  disetujui_sebagian: "warning",
  ditolak: "destructive",
  diproses: "warning",
  selesai: "secondary",
};

type Tab = "semua" | "diajukan" | "aktif" | "selesai" | "ditolak";

const TABS: { id: Tab; label: string }[] = [
  { id: "semua", label: "Semua" },
  { id: "diajukan", label: "Perlu Direview" },
  { id: "aktif", label: "Aktif (Proses/Kirim)" },
  { id: "selesai", label: "Selesai" },
  { id: "ditolak", label: "Ditolak" },
];

const columns: ColumnDef<Request, unknown>[] = [
  {
    header: "No. Permintaan",
    accessorKey: "request_number",
    cell: ({ row }) => (
      <Link
        to={`/permintaan/${row.original.id}`}
        className="font-mono text-sm text-brand-300 hover:underline"
      >
        {row.original.request_number}
      </Link>
    ),
  },
  { header: "Tanggal", accessorKey: "request_date" },
  { header: "No Tiket", accessorKey: "ticket_no" },
  {
    header: "Cabang / Gerai",
    accessorKey: "branch_name",
    cell: ({ row }) => (
      <div>
        <div className="font-medium">{row.original.branch_name}</div>
        {row.original.branch_code && (
          <div className="font-mono text-xs text-slate-500">{row.original.branch_code}</div>
        )}
      </div>
    ),
  },
  {
    header: "Status",
    accessorKey: "status",
    cell: ({ row }) => (
      <Badge variant={STATUS_VARIANT[row.original.status]}>
        {REQUEST_STATUS_LABELS[row.original.status]}
      </Badge>
    ),
  },
];

export function RequestListPage() {
  const { hasPermission } = useAuth();
  const [rows, setRows] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("semua");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("requests")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (cancelled) return;
      if (error) toast.error(error.message);
      else setRows((data ?? []) as Request[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { semua: rows.length, diajukan: 0, aktif: 0, selesai: 0, ditolak: 0 };
    for (const r of rows) {
      if (r.status === "diajukan") c.diajukan++;
      else if (r.status === "selesai") c.selesai++;
      else if (r.status === "ditolak") c.ditolak++;
      else c.aktif++;
    }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    if (tab === "semua") return rows;
    if (tab === "diajukan") return rows.filter((r) => r.status === "diajukan");
    if (tab === "selesai") return rows.filter((r) => r.status === "selesai");
    if (tab === "ditolak") return rows.filter((r) => r.status === "ditolak");
    return rows.filter((r) =>
      ["disetujui", "disetujui_sebagian", "diproses"].includes(r.status)
    );
  }, [rows, tab]);

  return (
    <div>
      <PageHeader
        title="Permintaan Barang"
        description="Alur permintaan: Kantor input → Gudang review → Helper proses → Kirim."
        actions={
          hasPermission("requests.create") ? (
            <Link to="/permintaan/baru">
              <Button>
                <Plus className="mr-1 h-4 w-4" /> Buat Permintaan
              </Button>
            </Link>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-full px-3 py-1.5 text-sm transition ${
              tab === t.id
                ? "bg-brand-400/15 text-brand-200 ring-1 ring-brand-400/30"
                : "bg-white/5 text-slate-400 ring-1 ring-white/10 hover:bg-white/10"
            }`}
          >
            {t.label}
            <span className="tnum ml-1.5 text-xs opacity-70">{counts[t.id]}</span>
          </button>
        ))}
      </div>

      <DataTable<Request>
        columns={columns}
        data={filtered}
        loading={loading}
        searchPlaceholder="Cari no. permintaan / tiket / gerai…"
        pageSize={15}
        emptyTitle="Belum ada permintaan"
        emptyDescription="Permintaan yang dibuat akan muncul di sini."
      />
    </div>
  );
}
