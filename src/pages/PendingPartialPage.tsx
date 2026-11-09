import { useEffect, useState } from "react";
import type { HTMLAttributes } from "react";
import { Link } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import * as XLSX from "xlsx";
import { Download, Hourglass } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { pendingJenisVariant, badgeDarkClass } from "../lib/statusColors";
import { buildSearchPattern } from "../lib/format";
import { cn } from "../lib/utils";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/ui/badge";
import { CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { DataTable } from "../components/DataTable";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";

interface PendingRow {
  id: string;
  request_id: string;
  request_number: string;
  ticket_no: string;
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

/** Permukaan kaca gelap — sama seperti dashboard. */
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

export function PendingPartialPage() {
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Ganti barang (stok kosong → ganti jenis barang).
  const [gantiRow, setGantiRow] = useState<PendingRow | null>(null);
  const [gantiQuery, setGantiQuery] = useState("");
  const [gantiResults, setGantiResults] = useState<{ id: string; sku: string; name: string }[]>([]);
  const [gantiSearching, setGantiSearching] = useState(false);
  const [gantiItem, setGantiItem] = useState<{ id: string; sku: string; name: string } | null>(null);
  const [gantiSaving, setGantiSaving] = useState(false);

  const columns: ColumnDef<PendingRow, unknown>[] = [
  {
    header: "No. Permintaan",
    accessorKey: "request_number",
    cell: ({ row }) => (
      <Link
        to={`/permintaan/${row.original.request_id}`}
        className="font-mono text-sm text-brand-200 hover:underline"
      >
        {row.original.request_number}
      </Link>
    ),
  },
  {
    header: "No. Tiket",
    accessorKey: "ticket_no",
    cell: ({ row }) => (
      <span className="font-mono text-sm">{row.original.ticket_no}</span>
    ),
  },
  { header: "Cabang / Gerai", accessorKey: "branch_name" },
  {
    header: "Barang",
    accessorKey: "name",
    cell: ({ row }) => (
      <div>
        <div className="font-medium">{row.original.name}</div>
        <div className="font-mono text-xs text-ink-300">{row.original.sku}</div>
      </div>
    ),
  },
  {
    header: "Jenis",
    accessorKey: "jenis",
    cell: ({ row }) => (
      <Badge
        variant={pendingJenisVariant[row.original.jenis]}
        className={badgeDarkClass[pendingJenisVariant[row.original.jenis]]}
      >
        {row.original.jenis}
      </Badge>
    ),
  },
  {
    header: "Sisa Belum Terkirim",
    accessorKey: "sisa",
    cell: ({ row }) => (
      <span className="tnum font-semibold text-warn-100">{fmt(row.original.sisa)}</span>
    ),
  },
  {
    header: "Keterangan Gudang",
    accessorKey: "keterangan",
    cell: ({ row }) => (
      <span className="text-xs text-ink-300">{row.original.keterangan ?? "—"}</span>
    ),
  },
  {
    header: "Minta / Setuju / Kirim",
    accessorKey: "qty_requested",
    cell: ({ row }) => (
      <span className="tnum text-xs text-ink-300">
        {fmt(row.original.qty_requested)} / {fmt(row.original.qty_approved)} /{" "}
        {fmt(row.original.qty_shipped)}
      </span>
    ),
  },
  {
    header: "Aksi",
    accessorKey: "id",
    cell: ({ row }) => (
      <div className="flex gap-1">
        <Link to={`/permintaan/${row.original.request_id}`}>
          <Button size="sm" variant="outline" className={DARK_OUTLINE_BTN}>
            {row.original.jenis === "Menunggu Stok" ? "Setujui" : "Kirim Susulan"}
          </Button>
        </Link>
        <Button
          size="sm"
          variant="outline"
          className={DARK_OUTLINE_BTN}
          onClick={() => {
            setGantiRow(row.original);
            setGantiQuery("");
            setGantiResults([]);
            setGantiItem(null);
          }}
        >
          Ganti Barang
        </Button>
      </div>
    ),
  },
];

  const searchGantiItems = async (q: string) => {
    const pattern = buildSearchPattern(q);
    const { data, error } = await supabase
      .from("inventory_items")
      .select("id, sku, name")
      .eq("is_active", true)
      .or(`sku.ilike.${pattern},name.ilike.${pattern}`)
      .order("name")
      .limit(15);
    if (error) {
      setGantiResults([]);
    } else {
      setGantiResults((data ?? []) as { id: string; sku: string; name: string }[]);
    }
    setGantiSearching(false);
  };

  const handleGantiQueryChange = (q: string) => {
    setGantiQuery(q);
    setGantiItem(null);
    setGantiSearching(true);
    if (q.trim().length < 2) {
      setGantiResults([]);
      setGantiSearching(false);
      return;
    }
    setTimeout(() => searchGantiItems(q.trim()), 300);
  };

  const submitGantiBarang = async () => {
    if (!gantiRow || !gantiItem) return;
    setGantiSaving(true);
    try {
      const { error } = await supabase
        .from("request_items")
        .update({ item_id: gantiItem.id, updated_at: new Date().toISOString() })
        .eq("id", gantiRow.id);
      if (error) throw new Error(error.message);
      toast.success(`"${gantiRow.name}" diganti jadi "${gantiItem.name}".`);
      setGantiRow(null);
      setGantiQuery("");
      setGantiResults([]);
      setGantiItem(null);
      // Refresh data.
      const { data } = await supabase
        .from("request_items")
        .select(
          "id, request_id, qty_requested, qty_approved, qty_shipped, resi, item_status, notes, inventory_items(sku, name), requests(request_number, ticket_no, branch_name)"
        )
        .in("item_status", ["pending_sebagian", "menunggu_stok"])
        .order("updated_at", { ascending: false })
        .limit(500);
      if (data) {
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
          requests: { request_number: string; ticket_no: string; branch_name: string } | { request_number: string; ticket_no: string; branch_name: string }[] | null;
        }[])
          .map((x) => {
            const isMenungguStok = x.item_status === "menunggu_stok";
            const approved = Number(x.qty_approved ?? 0);
            const shipped = Number(x.qty_shipped ?? 0);
            const requested = Number(x.qty_requested ?? 0);
            const dasar = isMenungguStok ? requested : (x.qty_approved != null ? approved : requested);
            return {
              id: x.id,
              request_id: x.request_id,
              request_number: one(x.requests)?.request_number ?? "—",
              ticket_no: one(x.requests)?.ticket_no ?? "—",
              branch_name: one(x.requests)?.branch_name ?? "—",
              sku: one(x.inventory_items)?.sku ?? "—",
              name: one(x.inventory_items)?.name ?? "—",
              qty_requested: requested,
              qty_approved: approved,
              qty_shipped: shipped,
              sisa: dasar - shipped,
              resi: x.resi,
              jenis: (isMenungguStok ? "Menunggu Stok" : "Belum Terkirim") as PendingRow["jenis"],
              keterangan: x.notes,
            };
          })
          .filter((x) => x.sisa > 0);
        setRows(mapped);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal ganti barang.");
    } finally {
      setGantiSaving(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("request_items")
        .select(
          "id, request_id, qty_requested, qty_approved, qty_shipped, resi, item_status, notes, inventory_items(sku, name), requests(request_number, ticket_no, branch_name)"
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
          requests: { request_number: string; ticket_no: string; branch_name: string } | { request_number: string; ticket_no: string; branch_name: string }[] | null;
        }[])
          .map((x) => {
            const isMenungguStok = x.item_status === "menunggu_stok";
            const approved = Number(x.qty_approved ?? 0);
            const shipped = Number(x.qty_shipped ?? 0);
            const requested = Number(x.qty_requested ?? 0);
            // Untuk pending_sebagian yang belum pernah disetujui (qty_approved NULL),
            // pakai qty_requested sebagai dasar sisa.
            const dasar = isMenungguStok ? requested : (x.qty_approved != null ? approved : requested);
            return {
              id: x.id,
              request_id: x.request_id,
              request_number: one(x.requests)?.request_number ?? "—",
              ticket_no: one(x.requests)?.ticket_no ?? "—",
              branch_name: one(x.requests)?.branch_name ?? "—",
              sku: one(x.inventory_items)?.sku ?? "—",
              name: one(x.inventory_items)?.name ?? "—",
              qty_requested: requested,
              qty_approved: approved,
              qty_shipped: shipped,
              sisa: dasar - shipped,
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
      "NO. TIKET",
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
        r.ticket_no,
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
          <Button variant="outline" className={DARK_OUTLINE_BTN} onClick={exportExcel} disabled={loading || rows.length === 0}>
            <Download className="mr-1 h-4 w-4" /> Export Excel
          </Button>
        }
      />

      <GlassCard className="mb-4">
        <CardContent className="flex items-center gap-4 p-5">
          <div className="rounded-xl bg-warn-500/15 p-2.5 text-warn-100 ring-1 ring-warn-500/25">
            <Hourglass className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-ink-300">
              Item menunggu stok / kiriman susulan
            </p>
            <p className="tnum font-display text-2xl font-bold text-white">
              {rows.length.toLocaleString("id-ID")}
            </p>
          </div>
        </CardContent>
      </GlassCard>

      <DataTable<PendingRow>
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Cari permintaan / barang / gerai…"
        pageSize={15}
        emptyTitle="Tidak ada sisa pending"
        emptyDescription="Tidak ada item yang menunggu stok atau kiriman susulan."
        renderCard={(row) => (
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link
                  to={`/permintaan/${row.request_id}`}
                  className="font-mono text-sm font-medium text-brand-200 hover:underline"
                >
                  {row.request_number}
                </Link>
                <div className="truncate text-xs text-ink-300">
                  {row.ticket_no} • {row.branch_name}
                </div>
              </div>
              <Badge
                variant={pendingJenisVariant[row.jenis]}
                className={cn(badgeDarkClass[pendingJenisVariant[row.jenis]], "shrink-0")}
              >
                {row.jenis}
              </Badge>
            </div>
            <div>
              <div className="font-medium">{row.name}</div>
              <div className="font-mono text-xs text-ink-300">{row.sku}</div>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-xs text-ink-300">Sisa belum terkirim</span>
              <span className="tnum text-lg font-bold text-warn-100">{fmt(row.sisa)}</span>
              <span className="tnum text-xs text-ink-300">
                ({fmt(row.qty_requested)} / {fmt(row.qty_approved)} / {fmt(row.qty_shipped)})
              </span>
            </div>
            {row.keterangan && (
              <p className="text-xs text-ink-300">{row.keterangan}</p>
            )}
            <div className="flex gap-2">
              <Link to={`/permintaan/${row.request_id}`} className="flex-1">
                <Button size="sm" variant="outline" className={cn(DARK_OUTLINE_BTN, "w-full")}>
                  {row.jenis === "Menunggu Stok" ? "Setujui" : "Kirim Susulan"}
                </Button>
              </Link>
              <Button
                size="sm"
                variant="outline"
                className={cn(DARK_OUTLINE_BTN, "flex-1")}
                onClick={() => {
                  setGantiRow(row);
                  setGantiQuery("");
                  setGantiResults([]);
                  setGantiItem(null);
                }}
              >
                Ganti Barang
              </Button>
            </div>
          </div>
        )}
      />

      {/* Dialog ganti barang (stok kosong → ganti jenis barang) */}
      <Dialog open={!!gantiRow} onOpenChange={(o) => !o && setGantiRow(null)}>
        <DialogHeader>
          <DialogTitle>Ganti Barang</DialogTitle>
          <DialogDescription>
            {gantiRow ? (
              <>
                Ganti <b>{gantiRow.name}</b> ({gantiRow.sku}) — sisa {gantiRow.sisa} — dengan
                barang lain karena stok kosong.
              </>
            ) : (
              "Pilih barang pengganti."
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Cari Barang Pengganti</Label>
            <Input
              value={gantiQuery}
              onChange={(e) => handleGantiQueryChange(e.target.value)}
              placeholder="Ketik nama atau SKU barang…"
            />
            {gantiSearching && <p className="text-xs text-ink-500">Mencari…</p>}
            {gantiResults.length > 0 && !gantiItem && (
              <div className="max-h-48 overflow-y-auto rounded-lg border border-ink-200 bg-white">
                {gantiResults.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-brand-50"
                    onClick={() => {
                      setGantiItem(r);
                      setGantiQuery(r.name);
                      setGantiResults([]);
                    }}
                  >
                    <span className="font-medium">{r.name}</span>
                    <span className="ml-2 font-mono text-xs text-ink-500">{r.sku}</span>
                  </button>
                ))}
              </div>
            )}
            {gantiItem && (
              <p className="text-xs text-ink-500">
                Diganti jadi: <b className="text-ink-800">{gantiItem.name}</b>{" "}
                <span className="font-mono">({gantiItem.sku})</span>
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setGantiRow(null)} disabled={gantiSaving}>
            Batal
          </Button>
          <Button onClick={submitGantiBarang} disabled={gantiSaving || !gantiItem}>
            {gantiSaving ? "Menyimpan…" : "Ganti Barang"}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
