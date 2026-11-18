import { useEffect, useMemo, useState } from "react";
import type { HTMLAttributes } from "react";
import { useSearchParams } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { supabase } from "../lib/supabase";
import { cn } from "../lib/utils";
import { badgeDarkClass } from "../lib/statusColors";
import { useAuth } from "../context/AuthContext";
import { formatDate, formatQty } from "../lib/format";
import { exportToCsv } from "../lib/csv";
import { PageHeader } from "../components/PageHeader";
import { DataTable } from "../components/DataTable";
import { Badge } from "../components/ui/badge";
import { CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Select } from "../components/ui/select";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";

interface LogRow {
  id: string;
  transactionId: string;
  itemId: string;
  qtyChange: number;
  qtyAfter: number;
  createdAt: string;
  txnDate: string;
  docNumber: string;
  txnType: string;
  reference: string;
  ticket: string;
  notes: string;
  sku: string;
  itemName: string;
  resi: string;
  gerai: string;
  location: string;
  locationCode: string;
  jenisStokLabel: string;
  userName: string;
}

/** Klasifikasi jenis stok (Baru / Retur / Unready) dari kode lokasi. */
function classifyJenisStok(code: string): { label: string; variant: "success" | "warning" | "destructive" } | null {
  const c = (code ?? "").toUpperCase();
  if (c.includes("RETUR")) return { label: "Retur", variant: "warning" };
  if (c.includes("UNREADY")) return { label: "Unready", variant: "destructive" };
  if (c.includes("BARU")) return { label: "Baru", variant: "success" };
  return null;
}

/** Label tipe transaksi untuk dialog detail. */
function txnTypeLabel(t: string): string {
  return (
    {
      in: "Barang Masuk",
      out: "Barang Keluar",
      transfer: "Transfer Stok",
      adjust: "Penyesuaian",
      opname: "Stock Opname",
      return: "Retur",
    } as Record<string, string>
  )[t] ?? t;
}
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

export function TransactionLogPage() {
  const { isSuperAdmin } = useAuth();
  const [searchParams] = useSearchParams();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Filter awal boleh datang dari URL (mis. kartu dashboard Inbound/Outbound hari ini).
  const [dateFrom, setDateFrom] = useState(() => {
    const v = searchParams.get("dari") ?? "";
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
  });
  const [dateTo, setDateTo] = useState(() => {
    const v = searchParams.get("sampai") ?? "";
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
  });
  const [jenis, setJenis] = useState(() => {
    const v = searchParams.get("jenis");
    return v === "in" || v === "out" ? v : "";
  });
  const [jenisStok, setJenisStok] = useState("");
  // Koreksi jenis stok (khusus super admin).
  const [editRow, setEditRow] = useState<LogRow | null>(null);
  const [editJenis, setEditJenis] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  // Hapus log transaksi + kembalikan stok (khusus super admin).
  const [deleteRow, setDeleteRow] = useState<LogRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  // Detail transaksi (klik baris) — gerai, keterangan & rincian lengkap.
  const [detailRow, setDetailRow] = useState<LogRow | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("inventory_ledger")
        .select(
          "id, item_id, qty_change, qty_after, created_at, transaction_id, " +
            "inventory_transactions!inner(doc_number, transaction_date, type, reference, notes, created_by), " +
            "inventory_items!inner(sku, name), " +
            "locations!inner(code, name, warehouses(name))"
        )
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) throw new Error(error.message);

      const raw = (data ?? []) as unknown as {
        id: string;
        item_id: string;
        qty_change: number | string;
        qty_after: number | string;
        created_at: string;
        transaction_id: string;
        inventory_transactions: { doc_number: string; transaction_date: string; type: string; reference: string | null; notes: string | null; created_by: string | null } | { doc_number: string; transaction_date: string; type: string; reference: string | null; notes: string | null; created_by: string | null }[];
        inventory_items: { sku: string; name: string } | { sku: string; name: string }[];
        locations: { code: string; name: string; warehouses: { name: string }[] | null } | { code: string; name: string; warehouses: { name: string }[] | null }[];
      }[];
      const txIds = [...new Set(raw.map((r) => r.transaction_id))];
      const reqNums = [...new Set(
        raw.map((r) => {
          const tx = Array.isArray(r.inventory_transactions) ? r.inventory_transactions[0] : r.inventory_transactions;
          const m = tx?.reference?.match(/REQ-KIRIM\/(REQ-[\w-]+)/);
          return m ? m[1] : null;
        }).filter(Boolean) as string[]
      )];
      const userIds = [...new Set(
        raw.map((r) => {
          const tx = Array.isArray(r.inventory_transactions) ? r.inventory_transactions[0] : r.inventory_transactions;
          return tx?.created_by;
        }).filter(Boolean) as string[]
      )];

      // Ambil resi & gerai per baris transaksi.
      const itemDetail = new Map<string, { resi: string; gerai: string }>();
      for (let i = 0; i < txIds.length; i += 100) {
        const { data: tis } = await supabase
          .from("inventory_transaction_items")
          .select("transaction_id, item_id, resi, gerai")
          .in("transaction_id", txIds.slice(i, i + 100));
        for (const t of (tis ?? []) as { transaction_id: string; item_id: string; resi: string | null; gerai: string | null }[]) {
          const k = `${t.transaction_id}|${t.item_id}`;
          itemDetail.set(k, { resi: t.resi ?? "", gerai: t.gerai ?? "" });
        }
      }

      // Tiket dari nomor permintaan.
      const ticketMap = new Map<string, string>();
      for (let i = 0; i < reqNums.length; i += 100) {
        const { data: reqs } = await supabase
          .from("requests")
          .select("request_number, ticket_no")
          .in("request_number", reqNums.slice(i, i + 100));
        for (const q of (reqs ?? []) as { request_number: string; ticket_no: string }[])
          ticketMap.set(q.request_number, q.ticket_no);
      }

      // Nama user (profiles + fallback user_accounts).
      const userMap = new Map<string, string>();
      if (userIds.length > 0) {
        const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", userIds);
        for (const p of (profs ?? []) as { id: string; full_name: string | null }[])
          if (p.full_name) userMap.set(p.id, p.full_name);
        const { data: uas } = await supabase
          .from("user_accounts")
          .select("auth_user_id, display_name")
          .in("auth_user_id", userIds);
        for (const ua of (uas ?? []) as { auth_user_id: string | null; display_name: string }[])
          if (ua.auth_user_id && ua.display_name) userMap.set(ua.auth_user_id, ua.display_name);
      }

      const mapped: LogRow[] = raw.map((r) => {
        const tx = (Array.isArray(r.inventory_transactions) ? r.inventory_transactions[0] : r.inventory_transactions) ?? null;
        const it = (Array.isArray(r.inventory_items) ? r.inventory_items[0] : r.inventory_items) ?? null;
        const loc = (Array.isArray(r.locations) ? r.locations[0] : r.locations) ?? null;
        const itemId = r.item_id ?? "";
        const det = itemDetail.get(`${r.transaction_id}|${itemId}`) ?? { resi: "", gerai: "" };
        const m = tx?.reference?.match(/REQ-KIRIM\/(REQ-[\w-]+)/);
        const ticket = m ? ticketMap.get(m[1]) ?? m[1] : "";
        const locationCode = loc?.code ?? "";
        const jenisInfo = classifyJenisStok(locationCode);
        return {
          id: r.id,
          transactionId: r.transaction_id,
          itemId: r.item_id,
          qtyChange: Number(r.qty_change),
          qtyAfter: Number(r.qty_after),
          createdAt: r.created_at,
          txnDate: tx?.transaction_date ?? r.created_at.slice(0, 10),
          docNumber: tx?.doc_number ?? "",
          txnType: tx?.type ?? "",
          reference: tx?.reference ?? "",
          ticket,
          notes: tx?.notes ?? "",
          sku: it?.sku ?? "",
          itemName: it?.name ?? "",
          resi: det.resi,
          gerai: det.gerai,
          location: loc ? `${loc.warehouses?.[0]?.name ?? ""} — ${loc.name}`.replace(/^ — /, "") : "",
          locationCode,
          jenisStokLabel: jenisInfo?.label ?? "",
          userName: tx?.created_by ? userMap.get(tx.created_by) ?? tx.created_by.slice(0, 8) : "—",
        };
      });
      setRows(mapped);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memuat log transaksi.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (dateFrom && r.txnDate < dateFrom) return false;
      if (dateTo && r.txnDate > dateTo) return false;
      if (jenis === "in" && r.qtyChange <= 0) return false;
      if (jenis === "out" && r.qtyChange >= 0) return false;
      if (jenisStok === "baru" && !r.locationCode.toUpperCase().includes("BARU")) return false;
      if (jenisStok === "retur" && !r.locationCode.toUpperCase().includes("RETUR")) return false;
      if (jenisStok === "unready" && !r.locationCode.toUpperCase().includes("UNREADY")) return false;
      return true;
    });
  }, [rows, dateFrom, dateTo, jenis, jenisStok]);

  const totalIn = useMemo(
    () => filtered.filter((r) => r.qtyChange > 0).reduce((s, r) => s + r.qtyChange, 0),
    [filtered]
  );
  const totalOut = useMemo(
    () => filtered.filter((r) => r.qtyChange < 0).reduce((s, r) => s + Math.abs(r.qtyChange), 0),
    [filtered]
  );

  const columns: ColumnDef<LogRow, unknown>[] = [
    {
      header: "Tanggal",
      accessorKey: "txnDate",
      cell: ({ row }) => formatDate(row.original.txnDate),
    },
    {
      header: "Ticket",
      accessorKey: "ticket",
      cell: ({ row }) => row.original.ticket || "—",
    },
    {
      header: "No Resi",
      accessorKey: "resi",
      cell: ({ row }) => row.original.resi || "—",
    },
    {
      header: "Kode",
      accessorKey: "sku",
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.sku}</span>,
    },
    {
      header: "Barang",
      accessorKey: "itemName",
      cell: ({ row }) => <span className="font-medium">{row.original.itemName}</span>,
    },
    {
      header: "IN",
      id: "in",
      cell: ({ row }) =>
        row.original.qtyChange > 0 ? (
          <span className="tnum font-semibold text-ok-100">+{formatQty(row.original.qtyChange)}</span>
        ) : (
          <span className="text-ink-300">—</span>
        ),
    },
    {
      header: "OUT",
      id: "out",
      cell: ({ row }) =>
        row.original.qtyChange < 0 ? (
          <span className="tnum font-semibold text-brand-200">-{formatQty(Math.abs(row.original.qtyChange))}</span>
        ) : (
          <span className="text-ink-300">—</span>
        ),
    },
    {
      header: "Jenis Stok",
      accessorKey: "jenisStokLabel",
      cell: ({ row }) => {
        const info = classifyJenisStok(row.original.locationCode);
        return info ? (
          <Badge variant={info.variant} className={badgeDarkClass[info.variant]} title={row.original.location}>
            {info.label}
          </Badge>
        ) : (
          <span className="text-ink-300" title={row.original.location}>
            —
          </span>
        );
      },
    },
    {
      header: "Gerai",
      accessorKey: "gerai",
      cell: ({ row }) => (
        <span className="block max-w-36 truncate" title={row.original.gerai || undefined}>
          {row.original.gerai || "—"}
        </span>
      ),
    },
    {
      header: "Keterangan",
      accessorKey: "notes",
      cell: ({ row }) => (
        <span className="block max-w-40 truncate text-ink-300" title={row.original.notes || row.original.docNumber}>
          {row.original.notes || row.original.docNumber || "—"}
        </span>
      ),
    },
    {
      header: "User",
      accessorKey: "userName",
      cell: ({ row }) => (
        <span title={row.original.userName}>{row.original.userName.split("@")[0]}</span>
      ),
    },
    // Kolom Aksi sengaja tidak ada: koreksi & hapus log hanya lewat dialog
    // detail (klik baris), dan hanya untuk super admin — user lain cuma
    // melihat detail tanpa tombol aksi.
  ];

  const saveCorrection = async () => {
    if (!editRow || !editJenis) {
      toast.error("Pilih jenis stok yang benar.");
      return;
    }
    setEditBusy(true);
    try {
      const { data, error } = await supabase.rpc("admin_correct_txn_item", {
        p_transaction_id: editRow.transactionId,
        p_item_id: editRow.itemId,
        p_new_status_aset:
          editJenis === "retur" ? "ASSET RETUR" : editJenis === "unready" ? "UNREADY" : "ASSET BARU",
        p_reason: editReason.trim() || null,
      });
      if (error) throw new Error(error.message);
      const res = data as { moved: boolean; doc: string | null; old_status: string; new_status: string; note?: string } | null;
      toast.success(
        res?.moved
          ? `Jenis stok dikoreksi (${res.old_status} → ${res.new_status}). Stok antar lokasi disesuaikan.`
          : "Jenis stok diperbarui."
      );
      setEditRow(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mengoreksi.");
    } finally {
      setEditBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteRow) return;
    setDeleteBusy(true);
    try {
      const { data, error } = await supabase.rpc("void_inventory_transaction", {
        p_transaction_id: deleteRow.transactionId,
      });
      if (error) throw new Error(error.message);
      const res = data as { deleted: boolean; doc: string; ledger_rows: number } | null;
      toast.success(`Log ${res?.doc ?? ""} dihapus, stok dikembalikan.`);
      setDeleteRow(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menghapus.");
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleExport = () => {
    if (filtered.length === 0) {
      toast.error("Tidak ada data untuk diekspor.");
      return;
    }
    exportToCsv(
      "log-transaksi",
      filtered.map((r) => ({
        Tanggal: formatDate(r.txnDate),
        Ticket: r.ticket,
        "No Dokumen": r.docNumber,
        "No Resi": r.resi,
        Kode: r.sku,
        Barang: r.itemName,
        IN: r.qtyChange > 0 ? r.qtyChange : "",
        OUT: r.qtyChange < 0 ? Math.abs(r.qtyChange) : "",
        "Jenis Stok": r.jenisStokLabel,
        Gerai: r.gerai,
        Lokasi: r.location,
        Keterangan: r.notes,
        User: r.userName,
      }))
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Log Transaksi"
        description="Buku kas pergerakan barang — setiap baris IN/OUT tercatat detail."
        actions={
          <Button variant="outline" size="sm" className={DARK_OUTLINE_BTN} onClick={handleExport}>
            <Download className="mr-1 h-4 w-4" /> Export CSV
          </Button>
        }
      />

      <div className="grid grid-cols-3 gap-3">
        <GlassCard>
          <CardContent className="pt-4">
            <p className="text-xs text-ink-300">TOTAL IN</p>
            <p className="tnum font-display text-xl font-bold text-ok-100">+{formatQty(totalIn)}</p>
          </CardContent>
        </GlassCard>
        <GlassCard>
          <CardContent className="pt-4">
            <p className="text-xs text-ink-300">TOTAL OUT</p>
            <p className="tnum font-display text-xl font-bold text-brand-200">-{formatQty(totalOut)}</p>
          </CardContent>
        </GlassCard>
        <GlassCard>
          <CardContent className="pt-4">
            <p className="text-xs text-ink-300">SELISIH IN − OUT</p>
            <p className={`tnum font-display text-xl font-bold ${totalIn - totalOut >= 0 ? "text-warn-100" : "text-brand-200"}`}>
              {totalIn - totalOut >= 0 ? "+" : ""}{formatQty(totalIn - totalOut)}
            </p>
          </CardContent>
        </GlassCard>
      </div>

      <GlassCard>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-ink-300">Filter:</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-9 rounded-lg border border-white/15 bg-white/10 px-3 text-sm text-white [color-scheme:dark]"
            />
            <span className="text-sm text-ink-300">s/d</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-9 rounded-lg border border-white/15 bg-white/10 px-3 text-sm text-white [color-scheme:dark]"
            />
            {(dateFrom || dateTo || jenis || jenisStok) && (
              <Button variant="outline" size="sm" className={DARK_OUTLINE_BTN} onClick={() => { setDateFrom(""); setDateTo(""); setJenis(""); setJenisStok(""); }}>
                Reset
              </Button>
            )}
            <div className="ml-auto flex gap-3">
              <div className="w-44">
                <Select
                  placeholder="Jenis stok: Semua"
                  value={jenisStok}
                  className="border-white/15 bg-white/10 text-white [color-scheme:dark]"
                  onValueChange={setJenisStok}
                  options={[
                    { value: "baru", label: "Stok Baru" },
                    { value: "retur", label: "Stok Retur" },
                    { value: "unready", label: "Stok Unready" },
                  ]}
                />
              </div>
              <div className="w-48">
                <Select
                  placeholder="Semua IN & OUT"
                  value={jenis}
                  className="border-white/15 bg-white/10 text-white [color-scheme:dark]"
                  onValueChange={setJenis}
                  options={[
                    { value: "in", label: "IN saja" },
                    { value: "out", label: "OUT saja" },
                  ]}
                />
              </div>
            </div>
          </div>

          <DataTable
            columns={columns}
            data={filtered}
            loading={loading}
            compact
            onRowClick={setDetailRow}
            searchPlaceholder="Cari tanggal, tiket, resi, barang, gerai, jenis stok…"
            emptyTitle="Tidak ada log"
            emptyDescription="Belum ada pergerakan barang pada filter saat ini."
          />
        </CardContent>
      </GlassCard>

      {/* Dialog detail transaksi (klik baris) — gerai, keterangan & rincian lengkap. */}
      <Dialog open={!!detailRow} onOpenChange={(open) => !open && setDetailRow(null)}>
        {detailRow && (
          <>
            <DialogHeader>
              <DialogTitle>Detail Transaksi {detailRow.docNumber}</DialogTitle>
              <DialogDescription>
                {txnTypeLabel(detailRow.txnType)} — {formatDate(detailRow.txnDate)}
              </DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <dt className="text-ink-500">Tanggal Transaksi</dt>
                <dd className="font-medium">{formatDate(detailRow.txnDate)}</dd>
              </div>
              <div>
                <dt className="text-ink-500">Referensi</dt>
                <dd className="font-medium">{detailRow.reference || "—"}</dd>
              </div>
              <div>
                <dt className="text-ink-500">Ticket</dt>
                <dd className="font-medium">{detailRow.ticket || "—"}</dd>
              </div>
              <div>
                <dt className="text-ink-500">No Resi</dt>
                <dd className="font-medium">{detailRow.resi || "—"}</dd>
              </div>
              <div>
                <dt className="text-ink-500">Lokasi</dt>
                <dd className="font-medium">{detailRow.location || "—"}</dd>
              </div>
              <div>
                <dt className="text-ink-500">Jenis Stok</dt>
                <dd className="font-medium">{detailRow.jenisStokLabel || "—"}</dd>
              </div>
              <div>
                <dt className="text-ink-500">Gerai</dt>
                <dd className="font-medium">{detailRow.gerai || "—"}</dd>
              </div>
              <div>
                <dt className="text-ink-500">User</dt>
                <dd className="font-medium">{detailRow.userName}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-ink-500">Catatan</dt>
                <dd className="font-medium break-words">{detailRow.notes || detailRow.docNumber || "—"}</dd>
              </div>
            </dl>
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold">Rincian Barang</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Nama</TableHead>
                    <TableHead className="text-right">Perubahan</TableHead>
                    <TableHead className="text-right">Stok Setelah</TableHead>
                    <TableHead>Status Asset</TableHead>
                    <TableHead>Resi</TableHead>
                    <TableHead>Gerai</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows
                    .filter((r) => r.transactionId === detailRow.transactionId)
                    .map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.sku}</TableCell>
                        <TableCell>{r.itemName}</TableCell>
                        <TableCell className="text-right">
                          {r.qtyChange > 0
                            ? `+${formatQty(r.qtyChange)}`
                            : `-${formatQty(Math.abs(r.qtyChange))}`}
                        </TableCell>
                        <TableCell className="text-right">{formatQty(r.qtyAfter)}</TableCell>
                        <TableCell>{r.jenisStokLabel || "—"}</TableCell>
                        <TableCell className="max-w-[160px] truncate" title={r.resi}>
                          {r.resi || "—"}
                        </TableCell>
                        <TableCell>{r.gerai || "—"}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
            <DialogFooter>
              {isSuperAdmin && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditRow(detailRow);
                      setEditJenis("");
                      setEditReason("");
                      setDetailRow(null);
                    }}
                  >
                    Koreksi jenis stok
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      setDeleteRow(detailRow);
                      setDetailRow(null);
                    }}
                  >
                    Hapus log
                  </Button>
                </>
              )}
              <Button variant="outline" onClick={() => setDetailRow(null)}>
                Tutup
              </Button>
            </DialogFooter>
          </>
        )}
      </Dialog>

      {/* Dialog koreksi jenis stok (khusus super admin) */}
      <Dialog open={!!editRow} onOpenChange={(o) => !o && setEditRow(null)}>
        <DialogHeader>
          <DialogTitle>Koreksi Jenis Stok</DialogTitle>
          <DialogDescription>
            {editRow && (
              <>
                {editRow.itemName} ({editRow.sku}) — {editRow.docNumber}
                <br />
                Jenis saat ini: <b>{editRow.jenisStokLabel || "—"}</b> · Lokasi: {editRow.location}
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Jenis stok yang benar</Label>
            <div className="mt-1">
              <Select
                placeholder="Pilih jenis stok…"
                value={editJenis}
                onValueChange={setEditJenis}
                options={[
                  { value: "baru", label: "Baru (Stok Barang Baru)" },
                  { value: "retur", label: "Retur (Stok Barang Retur)" },
                  { value: "unready", label: "Unready (Stok Unready)" },
                ]}
              />
            </div>
          </div>
          <div>
            <Label>Alasan koreksi</Label>
            <Textarea
              className="mt-1"
              rows={2}
              placeholder="cth: seharusnya ASSET RETUR sesuai permintaan A2610140956"
              value={editReason}
              onChange={(e) => setEditReason(e.target.value)}
            />
          </div>
          <p className="text-xs text-ink-500">
            Menyimpan akan memindahkan stok antar lokasi di database agar saldo benar,
            dan dicatat sebagai transaksi koreksi.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setEditRow(null)} disabled={editBusy}>
            Batal
          </Button>
          <Button onClick={saveCorrection} disabled={editBusy || !editJenis}>
            {editBusy ? "Menyimpan…" : "Simpan Koreksi"}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Dialog hapus log transaksi (khusus super admin) */}
      <Dialog open={!!deleteRow} onOpenChange={(o) => !o && setDeleteRow(null)}>
        <DialogHeader>
          <DialogTitle>Hapus Log Transaksi</DialogTitle>
          <DialogDescription>
            {deleteRow && (
              <>
                {deleteRow.itemName} ({deleteRow.sku}) — {deleteRow.docNumber}
                <br />
                <br />
                Log transaksi ini akan <b>dihapus permanen</b> dan stok akan{" "}
                <b>dikembalikan</b> seperti sebelum transaksi ini (dibatalkan).
                <br />
                <br />
                Lanjutkan?
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDeleteRow(null)} disabled={deleteBusy}>
            Batal
          </Button>
          <Button
            variant="destructive"
            onClick={confirmDelete}
            disabled={deleteBusy}
          >
            {deleteBusy ? "Menghapus…" : "Ya, Hapus"}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
