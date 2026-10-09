import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { formatDate, formatDateTime, formatQty } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { DataTable } from "../components/DataTable";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Label } from "../components/ui/label";
import { Select } from "../components/ui/select";
import { Textarea } from "../components/ui/textarea";
import { Card, CardContent } from "../components/ui/card";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import type {
  InventoryTransaction,
  InventoryTransactionItem,
  TransactionStatus,
  TransactionType,
} from "../types/database";
import {
  TRANSACTION_STATUS_LABELS,
  TRANSACTION_TYPE_LABELS,
} from "../types/database";

const TYPE_BADGE: Record<TransactionType, "success" | "destructive" | "info" | "warning" | "secondary" | "outline"> = {
  in: "success",
  out: "destructive",
  transfer: "info",
  adjust: "warning",
  opname: "secondary",
  return: "outline",
};

const STATUS_BADGE: Record<TransactionStatus, "success" | "destructive" | "warning"> = {
  draft: "warning",
  posted: "success",
  reversed: "destructive",
};

export function TransactionHistoryPage() {
  const { hasPermission } = useAuth();
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [locationMap, setLocationMap] = useState<Record<string, string>>({});
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [selected, setSelected] = useState<InventoryTransaction | null>(null);
  const [detailItems, setDetailItems] = useState<InventoryTransactionItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const [reverseTarget, setReverseTarget] = useState<InventoryTransaction | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [reversing, setReversing] = useState(false);

  const canAdjust = hasPermission("inventory.adjust");

  const loadTransactions = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("inventory_transactions")
      .select("*")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast.error(`Gagal memuat riwayat transaksi: ${error.message}`);
      return;
    }
    setTransactions((data ?? []) as InventoryTransaction[]);
  };

  useEffect(() => {
    loadTransactions();
    (async () => {
      const { data } = await supabase
        .from("locations")
        .select("id, name, warehouses(name)")
        .eq("is_active", true);
      // Hasil query join dinamis (client Supabase tanpa tipe generated).
      const map: Record<string, string> = {};
      for (const r of (data ?? []) as {
        id: string;
        name: string;
        warehouses: { name: string }[] | null;
      }[]) {
        map[r.id] = r.warehouses?.[0]
          ? `${r.warehouses[0].name} — ${r.name}`
          : r.name;
      }
      setLocationMap(map);
    })();
  }, []);

  const filtered = useMemo(() => {
    return transactions.filter(
      (t) =>
        (!typeFilter || t.type === typeFilter) &&
        (!statusFilter || t.status === statusFilter)
    );
  }, [transactions, typeFilter, statusFilter]);

  const openDetail = async (tx: InventoryTransaction) => {
    setSelected(tx);
    setDetailItems([]);
    setDetailLoading(true);
    const { data, error } = await supabase
      .from("inventory_transaction_items")
      .select("id, qty, unit_price, notes, inventory_items(sku, name)")
      .eq("transaction_id", tx.id);
    setDetailLoading(false);
    if (error) {
      toast.error(`Gagal memuat detail transaksi: ${error.message}`);
      return;
    }
    // Hasil query join dinamis (client Supabase tanpa tipe generated).
    setDetailItems((data ?? []) as unknown as InventoryTransactionItem[]);
  };

  const submitReverse = async () => {
    if (!reverseTarget) return;
    if (!reverseReason.trim()) {
      toast.error("Alasan koreksi/pembatalan wajib diisi.");
      return;
    }
    setReversing(true);
    try {
      const { error } = await supabase.rpc("reverse_inventory_transaction", {
        p_transaction_id: reverseTarget.id,
        p_reason: reverseReason.trim(),
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Transaksi koreksi dibuat");
      setReverseTarget(null);
      setReverseReason("");
      setSelected(null);
      await loadTransactions();
    } finally {
      setReversing(false);
    }
  };

  const columns: ColumnDef<InventoryTransaction, unknown>[] = [
    {
      header: "Nomor Dokumen",
      accessorKey: "doc_number",
      cell: ({ row }) => (
        <span className="font-medium">{row.original.doc_number}</span>
      ),
    },
    {
      header: "Tanggal",
      accessorKey: "transaction_date",
      cell: ({ row }) => formatDate(row.original.transaction_date),
    },
    {
      header: "Tipe",
      accessorKey: "type",
      cell: ({ row }) => (
        <Badge variant={TYPE_BADGE[row.original.type]}>
          {TRANSACTION_TYPE_LABELS[row.original.type]}
        </Badge>
      ),
    },
    {
      header: "Status",
      accessorKey: "status",
      cell: ({ row }) => (
        <Badge variant={STATUS_BADGE[row.original.status]}>
          {TRANSACTION_STATUS_LABELS[row.original.status]}
        </Badge>
      ),
    },
    {
      header: "Lokasi",
      id: "lokasi",
      cell: ({ row }) => {
        const src = row.original.source_location_id
          ? (locationMap[row.original.source_location_id] ?? "—")
          : "—";
        const dst = row.original.dest_location_id
          ? (locationMap[row.original.dest_location_id] ?? "—")
          : "—";
        return (
          <span className="text-sm">
            {src} <span className="text-slate-400">→</span> {dst}
          </span>
        );
      },
    },
    {
      header: "Dibuat Oleh",
      accessorKey: "created_by",
      cell: ({ row }) =>
        row.original.created_by ? row.original.created_by.slice(0, 8) : "—",
    },
    {
      header: "Aksi",
      id: "aksi",
      cell: ({ row }) => (
        <Button variant="outline" size="sm" onClick={() => openDetail(row.original)}>
          Detail
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Riwayat Transaksi"
        description="Daftar seluruh transaksi persediaan beserta detailnya"
      />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="w-full space-y-1.5 sm:max-w-xs">
              <Label htmlFor="filter-type">Tipe</Label>
              <Select
                id="filter-type"
                placeholder="Semua tipe"
                value={typeFilter}
                onValueChange={setTypeFilter}
                options={Object.entries(TRANSACTION_TYPE_LABELS).map(
                  ([value, label]) => ({ value, label })
                )}
              />
            </div>
            <div className="w-full space-y-1.5 sm:max-w-xs">
              <Label htmlFor="filter-status">Status</Label>
              <Select
                id="filter-status"
                placeholder="Semua status"
                value={statusFilter}
                onValueChange={setStatusFilter}
                options={Object.entries(TRANSACTION_STATUS_LABELS).map(
                  ([value, label]) => ({ value, label })
                )}
              />
            </div>
          </div>

          <DataTable
            columns={columns}
            data={filtered}
            loading={loading}
            searchPlaceholder="Cari nomor dokumen, lokasi…"
            emptyTitle="Tidak ada transaksi"
            emptyDescription="Belum ada transaksi yang cocok dengan filter saat ini."
          />
        </CardContent>
      </Card>

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        {selected && (
          <>
            <DialogHeader>
              <DialogTitle>Detail Transaksi {selected.doc_number}</DialogTitle>
              <DialogDescription>
                {TRANSACTION_TYPE_LABELS[selected.type]} —{" "}
                {TRANSACTION_STATUS_LABELS[selected.status]} —{" "}
                {formatDateTime(selected.created_at)}
              </DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-slate-500">Tanggal Transaksi</dt>
                <dd className="font-medium">{formatDate(selected.transaction_date)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Referensi</dt>
                <dd className="font-medium">{selected.reference || "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Lokasi Asal</dt>
                <dd className="font-medium">
                  {selected.source_location_id
                    ? (locationMap[selected.source_location_id] ?? "—")
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Lokasi Tujuan</dt>
                <dd className="font-medium">
                  {selected.dest_location_id
                    ? (locationMap[selected.dest_location_id] ?? "—")
                    : "—"}
                </dd>
              </div>
              {selected.notes && (
                <div className="col-span-2">
                  <dt className="text-slate-500">Catatan</dt>
                  <dd className="font-medium">{selected.notes}</dd>
                </div>
              )}
            </dl>
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold">Rincian Barang</h3>
              {detailLoading ? (
                <p className="text-sm text-slate-500">Memuat rincian…</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>Nama</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Harga Satuan</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detailItems.map((it) => (
                      <TableRow key={it.id}>
                        <TableCell className="font-medium">
                          {it.inventory_items?.sku ?? "—"}
                        </TableCell>
                        <TableCell>{it.inventory_items?.name ?? "—"}</TableCell>
                        <TableCell className="text-right">{formatQty(it.qty)}</TableCell>
                        <TableCell className="text-right">
                          {formatQty(it.unit_price)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
            <DialogFooter>
              {selected.status === "posted" && canAdjust && (
                <Button
                  variant="destructive"
                  onClick={() => setReverseTarget(selected)}
                >
                  Buat Koreksi / Batalkan
                </Button>
              )}
              <Button variant="outline" onClick={() => setSelected(null)}>
                Tutup
              </Button>
            </DialogFooter>
          </>
        )}
      </Dialog>

      <Dialog
        open={reverseTarget !== null}
        onOpenChange={(open) => !open && setReverseTarget(null)}
      >
        {reverseTarget && (
          <>
            <DialogHeader>
              <DialogTitle>Koreksi / Batalkan Transaksi</DialogTitle>
              <DialogDescription>
                Transaksi {reverseTarget.doc_number} akan dibalik. Tuliskan alasan
                koreksi — alasan wajib diisi.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="reverse-reason">Alasan</Label>
              <Textarea
                id="reverse-reason"
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                placeholder="Alasan koreksi / pembatalan…"
                maxLength={500}
                rows={4}
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setReverseTarget(null)}
                disabled={reversing}
              >
                Batal
              </Button>
              <Button
                variant="destructive"
                onClick={submitReverse}
                disabled={reversing || !reverseReason.trim()}
              >
                {reversing ? "Memproses…" : "Buat Transaksi Koreksi"}
              </Button>
            </DialogFooter>
          </>
        )}
      </Dialog>
    </div>
  );
}
