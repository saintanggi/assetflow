import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import * as XLSX from "xlsx";
import { Download, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
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

  // Filter tanggal & pencarian database (tiket, gerai, resi, barcode, SN).
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [serverQuery, setServerQuery] = useState("");
  const [exporting, setExporting] = useState(false);

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

  const load = async (opts?: { q?: string; from?: string; to?: string }) => {
    setLoading(true);
    const q = (opts?.q ?? serverQuery).trim();
    const from = opts?.from ?? dateFrom;
    const to = opts?.to ?? dateTo;
    try {
      if (q) {
        const clean = q.replace(/[%_,]/g, "");
        const pat = `%${clean}%`;
        const [reqMatch, itemMatch] = await Promise.all([
          supabase
            .from("requests")
            .select("id")
            .or(
              `ticket_no.ilike.${pat},request_number.ilike.${pat},branch_name.ilike.${pat},branch_code.ilike.${pat}`
            )
            .limit(300),
          supabase
            .from("request_items")
            .select("request_id")
            .or(
              `barcode.ilike.${pat},serial_number.ilike.${pat},resi.ilike.${pat},notes.ilike.${pat}`
            )
            .limit(300),
        ]);
        const idSet = new Set<string>();
        for (const r of (reqMatch.data ?? []) as { id: string }[]) idSet.add(r.id);
        for (const i of (itemMatch.data ?? []) as { request_id: string }[]) idSet.add(i.request_id);
        if (idSet.size === 0) {
          setRows([]);
          setLoading(false);
          return;
        }
        let qBuilder = supabase
          .from("requests")
          .select("*")
          .in("id", [...idSet].slice(0, 300))
          .order("request_date", { ascending: false })
          .order("created_at", { ascending: false });
        if (from) qBuilder = qBuilder.gte("request_date", from);
        if (to) qBuilder = qBuilder.lte("request_date", to);
        const { data, error } = await qBuilder;
        if (error) toast.error(error.message);
        else setRows((data ?? []) as Request[]);
      } else {
        let qBuilder = supabase
          .from("requests")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(500);
        if (from) qBuilder = qBuilder.gte("request_date", from);
        if (to) qBuilder = qBuilder.lte("request_date", to);
        const { data, error } = await qBuilder;
        if (error) toast.error(error.message);
        else setRows((data ?? []) as Request[]);
      }
    } finally {
      setLoading(false);
    }
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
  }, [dateFrom, dateTo]);

  const exportRekapExcel = async () => {
    if (filtered.length === 0) {
      toast.error("Tidak ada data permintaan untuk diekspor.");
      return;
    }
    setExporting(true);
    try {
      const reqIds = filtered.map((r) => r.id);
      const reqById = new Map(filtered.map((r) => [r.id, r]));
      const allItems: {
        request_id: string;
        qty_requested: number | string;
        qty_approved: number | string | null;
        qty_shipped: number | string;
        barcode: string | null;
        serial_number: string | null;
        item_type: string | null;
        status_aset: string | null;
        resi: string | null;
        item_status: string;
        notes: string | null;
        inventory_items: { sku: string; name: string } | { sku: string; name: string }[] | null;
      }[] = [];

      for (let i = 0; i < reqIds.length; i += 100) {
        const { data, error } = await supabase
          .from("request_items")
          .select(
            "request_id, qty_requested, qty_approved, qty_shipped, barcode, serial_number, item_type, status_aset, resi, item_status, notes, inventory_items(sku, name)"
          )
          .in("request_id", reqIds.slice(i, i + 100))
          .order("created_at", { ascending: true });
        if (error) throw new Error(error.message);
        allItems.push(...((data ?? []) as unknown as typeof allItems));
      }

      const headers = [
        "In Progress Date",
        "NO. PERMINTAAN",
        "NO TICKET",
        "CABANG/GERAI",
        "KODE GERAI",
        "NAMA BARANG",
        "QTY",
        "DISETUJUI",
        "TERKIRIM",
        "KETERANGAN",
        "RESI",
        "BARCODE",
        "TYPE BARANG",
        "STATUS REQUEST",
        "STATUS ASSET",
        "STATUS TERKIRIM",
      ];

      const sheetRows: (string | number)[][] = [headers];
      for (const it of allItems) {
        const req = reqById.get(it.request_id);
        if (!req) continue;
        const inv = Array.isArray(it.inventory_items) ? it.inventory_items[0] : it.inventory_items;
        const snList: string[] = [];
        const srList: string[] = [];
        for (const n of (it.notes ?? "").split("\n")) {
          for (const p of n.split("|").map((s) => s.trim())) {
            const ketM = p.match(/^Ket:\s*(.+)$/i);
            const srM = p.match(/^Status request:\s*(.+)$/i);
            if (ketM) snList.push(ketM[1].trim());
            else if (srM) srList.push(srM[1].trim());
          }
        }
        if (snList.length === 0 && it.serial_number) {
          snList.push(it.serial_number);
        }
        const statusTerkirim =
          it.item_status === "terkirim"
            ? "TERKIRIM"
            : ["pending_sebagian", "menunggu_stok"].includes(it.item_status)
              ? "PENDING"
              : it.item_status.toUpperCase();

        sheetRows.push([
          req.request_date ?? "",
          req.request_number ?? "",
          req.ticket_no ?? "",
          req.branch_name ?? "",
          req.branch_code ?? "",
          inv?.name ?? "—",
          Number(it.qty_requested ?? 0),
          it.qty_approved != null ? Number(it.qty_approved) : 0,
          Number(it.qty_shipped ?? 0),
          snList.join(", "),
          (it.resi ?? "").replace(/\n/g, ", "),
          (it.barcode ?? "").replace(/\n/g, ", "),
          it.item_type ?? "",
          [...new Set(srList)].join(", "),
          it.status_aset ?? "ASSET BARU",
          statusTerkirim,
        ]);
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheetRows), "REKAP_PENGIRIMAN");
      const today = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `Rekap_Pengiriman_${today}.xlsx`);
      toast.success(`Rekap Excel berhasil diunduh (${sheetRows.length - 1} baris barang).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mengekspor Excel.");
    } finally {
      setExporting(false);
    }
  };

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
      // Trigger database secara atomik menghapus ledger/transaksi turunan dan
      // mengembalikan saldo bersih tanpa membuat baris IN/OUT pembalik.
      const { error: delErr } = await supabase.from("requests").delete().eq("id", delReq.id);
      if (delErr) throw new Error(delErr.message);
      toast.success(`Permintaan ${delReq.ticket_no ?? delReq.request_number} dihapus; stok dipulihkan tanpa menambah history IN/OUT.`);
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
          className="font-mono text-sm text-brand-700 hover:underline"
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
            <div className="font-mono text-xs text-ink-500">{row.original.branch_code}</div>
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
                  className="text-brand-600 hover:text-brand-700"
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
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={exportRekapExcel}
              disabled={exporting || loading}
            >
              <Download className="mr-1 h-4 w-4" />
              {exporting ? "Mengekspor…" : "Export Rekap Excel"}
            </Button>
            {hasPermission("requests.create") && (
              <Link to="/permintaan/baru">
                <Button>
                  <Plus className="mr-1 h-4 w-4" /> Buat Permintaan
                </Button>
              </Link>
            )}
          </div>
        }
      />

      {/* Filter tanggal & pencarian penuh ke database (Resi / Barcode / SN / Tiket / Gerai) */}
      <Card className="mb-4">
        <CardContent className="grid gap-3 p-4 sm:grid-cols-12 sm:items-end">
          <form
            className="sm:col-span-6"
            onSubmit={(e) => {
              e.preventDefault();
              void load();
            }}
          >
            <Label htmlFor="req-track" className="mb-1 block text-xs text-ink-500">
              Lacak Database (No Tiket, Gerai, No Resi, Barcode, atau Serial Number)
            </Label>
            <div className="flex gap-2">
              <Input
                id="req-track"
                value={serverQuery}
                onChange={(e) => setServerQuery(e.target.value)}
                placeholder="Ketik resi, barcode, SN, no tiket, atau nama gerai…"
              />
              <Button type="submit" variant="outline" disabled={loading}>
                <Search className="mr-1 h-4 w-4" /> Cari
              </Button>
            </div>
          </form>
          <div className="sm:col-span-2">
            <Label htmlFor="req-from" className="mb-1 block text-xs text-ink-500">Dari Tanggal</Label>
            <Input
              id="req-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="req-to" className="mb-1 block text-xs text-ink-500">Sampai Tanggal</Label>
            <Input
              id="req-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            {(serverQuery || dateFrom || dateTo) && (
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setServerQuery("");
                  setDateFrom("");
                  setDateTo("");
                  void load({ q: "", from: "", to: "" });
                }}
              >
                <X className="mr-1 h-4 w-4" /> Reset Filter
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              tab === t.id
                ? "bg-brand-50 text-brand-700 ring-1 ring-brand-200"
                : "bg-white text-ink-600 ring-1 ring-ink-200 hover:bg-ink-50"
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
            {delReq?.ticket_no ?? delReq?.request_number} dan semua history transaksi OUT terkait
            akan dihapus permanen. Saldo stok dipulihkan seperti sebelum permintaan, tanpa membuat
            history IN/OUT pembalik. Jika stoknya sudah dipakai transaksi berikutnya, saldo lokasi dapat menjadi
            negatif dan perlu direkonsiliasi. Tindakan ini hanya untuk Super Admin dan tidak dapat dibatalkan.
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
