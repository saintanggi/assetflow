import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { DataTable } from "../components/DataTable";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
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

export function RequestListPage() {
  const { hasPermission, isSuperAdmin } = useAuth();
  const [rows, setRows] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("semua");

  // Edit & hapus (superadmin).
  const [editReq, setEditReq] = useState<Request | null>(null);
  const [eTicket, setETicket] = useState("");
  const [eBranch, setEBranch] = useState("");
  const [eBranchCode, setEBranchCode] = useState("");
  const [eDate, setEDate] = useState("");
  const [eNotes, setENotes] = useState("");
  const [eSaving, setESaving] = useState(false);
  const [delReq, setDelReq] = useState<Request | null>(null);
  const [delBusy, setDelBusy] = useState(false);

  const load = async () => {
    const { data, error } = await supabase
      .from("requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) toast.error(error.message);
    else setRows((data ?? []) as Request[]);
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await load();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openEdit = (r: Request) => {
    setEditReq(r);
    setETicket(r.ticket_no ?? "");
    setEBranch(r.branch_name ?? "");
    setEBranchCode(r.branch_code ?? "");
    setEDate(r.request_date ?? "");
    setENotes(r.notes ?? "");
  };

  const saveEdit = async () => {
    if (!editReq) return;
    setESaving(true);
    try {
      const { error } = await supabase
        .from("requests")
        .update({
          ticket_no: eTicket.trim() || null,
          branch_name: eBranch.trim(),
          branch_code: eBranchCode.trim() || null,
          request_date: eDate || editReq.request_date,
          notes: eNotes.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", editReq.id);
      if (error) throw new Error(error.message);
      toast.success("Permintaan diperbarui.");
      setEditReq(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan.");
    } finally {
      setESaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!delReq) return;
    setDelBusy(true);
    try {
      // 1) Balikkan transaksi pengiriman yang masih posted (stok kembali).
      //    Yang sudah reversed di-skip agar retry tidak gagal.
      const { data: txns } = await supabase
        .from("inventory_transactions")
        .select("id, status")
        .eq("reference", `REQ-KIRIM/${delReq.request_number}`)
        .eq("status", "posted");
      for (const t of (txns ?? []) as { id: string }[]) {
        const { error } = await supabase.rpc("reverse_inventory_transaction", {
          p_transaction_id: t.id,
          p_reason: `Permintaan ${delReq.ticket_no ?? delReq.request_number} dihapus superadmin`,
        });
        if (error) throw new Error(`Gagal membalikkan stok: ${error.message}`);
      }
      // 2) Hapus request (cascade ke request_items).
      const { error: delErr } = await supabase.from("requests").delete().eq("id", delReq.id);
      if (delErr) throw new Error(delErr.message);
      toast.success(`Permintaan ${delReq.ticket_no ?? delReq.request_number} dihapus, stok dikembalikan.`);
      setDelReq(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menghapus.");
    } finally {
      setDelBusy(false);
    }
  };

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
    ...(isSuperAdmin
      ? [
          {
            header: "",
            id: "aksi",
            cell: ({ row }: { row: { original: Request } }) => (
              <div className="flex gap-1">
                <Button variant="outline" size="sm" onClick={() => openEdit(row.original)}>
                  <Pencil className="h-3 w-3" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-rose-300 hover:text-rose-200"
                  onClick={() => setDelReq(row.original)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ),
          } as ColumnDef<Request, unknown>,
        ]
      : []),
  ];

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

      {/* Dialog edit (superadmin) */}
      <Dialog open={!!editReq} onOpenChange={(o) => !o && setEditReq(null)}>
        <DialogHeader>
          <DialogTitle>Edit Permintaan — {editReq?.ticket_no ?? editReq?.request_number}</DialogTitle>
          <DialogDescription>Ubah data header permintaan. Khusus superadmin.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 px-1 py-2 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>No Tiket</Label>
            <Input value={eTicket} onChange={(e) => setETicket(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Tanggal</Label>
            <Input type="date" value={eDate} onChange={(e) => setEDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Cabang / Gerai</Label>
            <Input value={eBranch} onChange={(e) => setEBranch(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Kode Gerai</Label>
            <Input value={eBranchCode} onChange={(e) => setEBranchCode(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Catatan</Label>
            <Textarea rows={3} value={eNotes} onChange={(e) => setENotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setEditReq(null)} disabled={eSaving}>
            Batal
          </Button>
          <Button onClick={saveEdit} disabled={eSaving}>
            {eSaving ? "Menyimpan…" : "Simpan"}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Dialog hapus (superadmin) */}
      <Dialog open={!!delReq} onOpenChange={(o) => !o && setDelReq(null)}>
        <DialogHeader>
          <DialogTitle>Hapus Permintaan?</DialogTitle>
          <DialogDescription>
            {delReq?.ticket_no ?? delReq?.request_number} akan dihapus permanen. Stok yang sudah
            terkirim akan <b>dikembalikan</b> otomatis. Tindakan ini tidak bisa dibatalkan.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDelReq(null)} disabled={delBusy}>
            Batal
          </Button>
          <Button variant="destructive" onClick={confirmDelete} disabled={delBusy}>
            {delBusy ? "Menghapus…" : "Ya, Hapus"}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
