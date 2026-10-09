import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Eye } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { formatDateTime } from "../lib/format";
import { DataTable } from "../components/DataTable";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import type { AuditLog } from "../types/database";

function prettyJson(value: unknown): string {
  if (value === null || value === undefined) return "—";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [aksiFilter, setAksiFilter] = useState("");
  const [entitasFilter, setEntitasFilter] = useState("");
  const [selected, setSelected] = useState<AuditLog | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("audit_logs")
      .select("*, profiles(email,full_name)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      toast.error("Gagal memuat audit log.");
    } else {
      setLogs((data ?? []) as unknown as AuditLog[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  const filtered = useMemo(() => {
    const a = aksiFilter.trim().toLowerCase();
    const e = entitasFilter.trim().toLowerCase();
    return logs.filter(
      (l) =>
        (!a || l.action.toLowerCase().includes(a)) &&
        (!e || l.entity_type.toLowerCase().includes(e))
    );
  }, [logs, aksiFilter, entitasFilter]);

  const columns = useMemo<ColumnDef<AuditLog, unknown>[]>(
    () => [
      {
        id: "waktu",
        header: "Waktu",
        cell: ({ row }) => (
          <span className="whitespace-nowrap">{formatDateTime(row.original.created_at)}</span>
        ),
      },
      {
        id: "aktor",
        header: "Aktor",
        cell: ({ row }) => row.original.profiles?.email ?? "—",
      },
      {
        id: "aksi",
        header: "Aksi",
        cell: ({ row }) => <Badge variant="secondary">{row.original.action}</Badge>,
      },
      {
        id: "entitas",
        header: "Entitas",
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.entity_type}</span>,
      },
      {
        id: "id",
        header: "ID Entitas",
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.entity_id ?? "—"}</span>
        ),
      },
      {
        id: "detail",
        header: "Detail",
        cell: ({ row }) => (
          <Button variant="ghost" size="sm" onClick={() => setSelected(row.original)}>
            <Eye className="mr-1 h-4 w-4" /> Lihat
          </Button>
        ),
      },
    ],
    []
  );

  return (
    <div>
      <PageHeader
        title="Audit Log"
        description="200 aktivitas terbaru — siapa melakukan apa, kapan, dan datanya."
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:max-w-2xl">
        <div className="space-y-1.5">
          <Label htmlFor="flt-aksi">Filter aksi</Label>
          <Input
            id="flt-aksi"
            value={aksiFilter}
            onChange={(e) => setAksiFilter(e.target.value)}
            placeholder="cth. create, update, delete…"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="flt-entitas">Filter tipe entitas</Label>
          <Input
            id="flt-entitas"
            value={entitasFilter}
            onChange={(e) => setEntitasFilter(e.target.value)}
            placeholder="cth. assets, inventory_items…"
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        loading={loading}
        searchPlaceholder="Cari…"
        pageSize={15}
      />

      <Dialog open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogHeader>
          <DialogTitle>Detail Perubahan</DialogTitle>
          <DialogDescription>
            {selected && (
              <>
                {selected.action} — <span className="font-mono">{selected.entity_type}</span> ·{" "}
                {formatDateTime(selected.created_at)}
                <br />
                Aktor: {selected.profiles?.email ?? "—"}
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">Data lama</h3>
            <pre className="max-h-72 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
              {prettyJson(selected?.old_data)}
            </pre>
          </div>
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">Data baru</h3>
            <pre className="max-h-72 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
              {prettyJson(selected?.new_data)}
            </pre>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
