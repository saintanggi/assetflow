import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { supabase } from "../lib/supabase";
import { formatDate, formatQty } from "../lib/format";
import { exportToCsv } from "../lib/csv";
import { PageHeader } from "../components/PageHeader";
import { DataTable } from "../components/DataTable";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Select } from "../components/ui/select";

interface LogRow {
  id: string;
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
  userName: string;
}

export function TransactionLogPage() {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [jenis, setJenis] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("inventory_ledger")
        .select(
          "id, qty_change, qty_after, created_at, transaction_id, " +
            "inventory_transactions!inner(doc_number, transaction_date, type, reference, notes, created_by), " +
            "inventory_items!inner(sku, name), " +
            "locations!inner(code, name, warehouses(name))"
        )
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) throw new Error(error.message);

      const raw = (data ?? []) as unknown as {
        id: string;
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
          // Butuh item_id untuk key — ambil dari raw via transaction_id saja tidak cukup;
          // simpan per transaction_id + resi/gerai pertama sebagai fallback.
          const k = `${t.transaction_id}|${t.item_id}`;
          itemDetail.set(k, { resi: t.resi ?? "", gerai: t.gerai ?? "" });
        }
      }

      // Petakan item_id per ledger row untuk key detail.
      const { data: ledgerItems } = await supabase
        .from("inventory_ledger")
        .select("id, item_id")
        .in("id", raw.map((r) => r.id));
      const ledgerItemMap = new Map(((ledgerItems ?? []) as { id: string; item_id: string }[]).map((x) => [x.id, x.item_id]));

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

      // Nama user.
      const userMap = new Map<string, string>();
      if (userIds.length > 0) {
        const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", userIds);
        for (const p of (profs ?? []) as { id: string; full_name: string | null }[])
          userMap.set(p.id, p.full_name ?? p.id.slice(0, 8));
      }

      const mapped: LogRow[] = raw.map((r) => {
        const tx = (Array.isArray(r.inventory_transactions) ? r.inventory_transactions[0] : r.inventory_transactions) ?? null;
        const it = (Array.isArray(r.inventory_items) ? r.inventory_items[0] : r.inventory_items) ?? null;
        const loc = (Array.isArray(r.locations) ? r.locations[0] : r.locations) ?? null;
        const itemId = ledgerItemMap.get(r.id) ?? "";
        const det = itemDetail.get(`${r.transaction_id}|${itemId}`) ?? { resi: "", gerai: "" };
        const m = tx?.reference?.match(/REQ-KIRIM\/(REQ-[\w-]+)/);
        const ticket = m ? ticketMap.get(m[1]) ?? m[1] : "";
        return {
          id: r.id,
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
      return true;
    });
  }, [rows, dateFrom, dateTo, jenis]);

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
          <span className="tnum font-semibold text-emerald-300">+{formatQty(row.original.qtyChange)}</span>
        ) : (
          <span className="text-slate-600">—</span>
        ),
    },
    {
      header: "OUT",
      id: "out",
      cell: ({ row }) =>
        row.original.qtyChange < 0 ? (
          <span className="tnum font-semibold text-rose-300">-{formatQty(Math.abs(row.original.qtyChange))}</span>
        ) : (
          <span className="text-slate-600">—</span>
        ),
    },
    {
      header: "Gerai",
      accessorKey: "gerai",
      cell: ({ row }) => row.original.gerai || "—",
    },
    {
      header: "Keterangan",
      accessorKey: "notes",
      cell: ({ row }) => (
        <span className="block max-w-56 truncate text-slate-400" title={row.original.notes || row.original.docNumber}>
          {row.original.notes || row.original.docNumber || "—"}
        </span>
      ),
    },
    {
      header: "User",
      accessorKey: "userName",
      cell: ({ row }) => row.original.userName,
    },
  ];

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
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="mr-1 h-4 w-4" /> Export CSV
          </Button>
        }
      />

      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-slate-500">TOTAL IN</p>
            <p className="tnum font-display text-xl font-bold text-emerald-300">+{formatQty(totalIn)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-slate-500">TOTAL OUT</p>
            <p className="tnum font-display text-xl font-bold text-rose-300">-{formatQty(totalOut)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-slate-500">SELISIH IN − OUT</p>
            <p className={`tnum font-display text-xl font-bold ${totalIn - totalOut >= 0 ? "text-amber-300" : "text-rose-300"}`}>
              {totalIn - totalOut >= 0 ? "+" : ""}{formatQty(totalIn - totalOut)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-slate-400">Filter:</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-slate-200"
            />
            <span className="text-sm text-slate-500">s/d</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-slate-200"
            />
            {(dateFrom || dateTo || jenis) && (
              <Button variant="outline" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); setJenis(""); }}>
                Reset
              </Button>
            )}
            <div className="ml-auto w-48">
              <Select
                placeholder="Semua IN & OUT"
                value={jenis}
                onValueChange={setJenis}
                options={[
                  { value: "in", label: "IN saja" },
                  { value: "out", label: "OUT saja" },
                ]}
              />
            </div>
          </div>

          <DataTable
            columns={columns}
            data={filtered}
            loading={loading}
            searchPlaceholder="Cari tanggal, tiket, resi, barang, gerai…"
            emptyTitle="Tidak ada log"
            emptyDescription="Belum ada pergerakan barang pada filter saat ini."
          />
        </CardContent>
      </Card>
    </div>
  );
}
