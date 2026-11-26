import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Eye } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { fetchAllPages } from "../lib/supabasePagination";
import { formatDateTime } from "../lib/format";
import { badgeDarkClass } from "../lib/statusColors";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import type { AuditLog } from "../types/database";

/** Label berbahasa Indonesia untuk kunci data — sisanya dirapikan otomatis. */
const FIELD_LABELS: Record<string, string> = {
  sku: "SKU",
  name: "Nama",
  brand: "Merek",
  model: "Model",
  barcode: "Barcode",
  unit_id: "Satuan",
  is_active: "Aktif",
  min_stock: "Stok Minimum",
  photo_url: "Foto",
  category_id: "Kategori",
  location_id: "Lokasi",
  supplier_id: "Supplier",
  purchase_price: "Harga Beli",
  type: "Tipe",
  status: "Status",
  transaction_date: "Tanggal Transaksi",
  source_location_id: "Lokasi Asal",
  dest_location_id: "Lokasi Tujuan",
  notes: "Catatan",
  reference: "Referensi",
  created_by: "Dibuat Oleh",
  posted_at: "Waktu Posting",
  item_id: "Barang",
  request_id: "Permintaan",
  qty: "Qty",
  qty_change: "Perubahan Qty",
  qty_after: "Stok Setelah",
  opening_qty: "Stok Awal",
  net_ledger: "Pergerakan Bersih (Log)",
  location_code: "Kode Lokasi",
  qty_requested: "Qty Diminta",
  qty_approved: "Qty Disetujui",
  qty_shipped: "Qty Terkirim",
  item_status: "Status Item",
  status_aset: "Status Asset",
  resi: "Resi",
  gerai: "Gerai",
  ticket_no: "No. Tiket",
  request_number: "No. Permintaan",
  branch_name: "Cabang / Gerai",
  branch_code: "Kode Gerai",
  request_date: "Tanggal Permintaan",
  requested_by: "Diminta Oleh",
  reviewed_by: "Direview Oleh",
  reviewed_at: "Waktu Review",
  doc_number: "No. Dokumen",
  id: "ID",
  created_at: "Dibuat",
  updated_at: "Diupdate",
  email: "Email",
  full_name: "Nama Lengkap",
};

function fieldLabel(key: string): string {
  return (
    FIELD_LABELS[key] ??
    key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

type Lookups = {
  units: Map<string, string>;
  categories: Map<string, string>;
  locations: Map<string, string>;
  suppliers: Map<string, string>;
  items: Map<string, string>;
  requests: Map<string, string>;
  profiles: Map<string, string>;
};

function resolveId(key: string, value: string, lookups: Lookups | null): string | null {
  if (!lookups) return null;
  const byField: Record<string, Map<string, string>> = {
    unit_id: lookups.units,
    category_id: lookups.categories,
    location_id: lookups.locations,
    source_location_id: lookups.locations,
    dest_location_id: lookups.locations,
    supplier_id: lookups.suppliers,
    item_id: lookups.items,
    request_id: lookups.requests,
  };
  return byField[key]?.get(value) ?? lookups.profiles.get(value) ?? null;
}

/** Nilai data jadi teks yang bisa dibaca orang (bukan UUID mentah / JSON). */
function formatValue(key: string, value: unknown, lookups: Lookups | null): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Ya" : "Tidak";
  if (typeof value === "number")
    return value.toLocaleString("id-ID", { maximumFractionDigits: 3 });
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      try {
        return formatDateTime(value);
      } catch {
        return value;
      }
    }
    if (key.endsWith("_id") || key === "id") {
      const resolved = resolveId(key, value, lookups);
      if (resolved) return resolved;
      return value.length > 13 ? `${value.slice(0, 8)}…` : value;
    }
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const isEqual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** updated_at berubah di setiap UPDATE — bukan perubahan isi, jadi disembunyikan. */
const NOISE_KEYS = new Set(["updated_at"]);

interface DiffRow {
  key: string;
  old: unknown;
  next: unknown;
}

function diffEntries(
  oldData: Record<string, unknown> | null,
  newData: Record<string, unknown> | null,
): DiffRow[] {
  const keys = [
    ...new Set([...Object.keys(oldData ?? {}), ...Object.keys(newData ?? {})]),
  ].filter((k) => !NOISE_KEYS.has(k));
  return keys
    .filter((k) => !isEqual(oldData?.[k], newData?.[k]))
    .map((k) => ({ key: k, old: oldData?.[k], next: newData?.[k] }));
}

/** Isi satu record (INSERT / DELETE) sebagai daftar field — tanpa id & waktu. */
function recordEntries(data: Record<string, unknown> | null): { key: string; value: unknown }[] {
  return Object.entries(data ?? {})
    .filter(([k]) => k !== "id" && k !== "created_at" && k !== "updated_at")
    .map(([key, value]) => ({ key, value }));
}

const AUDIT_PAGE_SIZE = 200;

export function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [aksiFilter, setAksiFilter] = useState("");
  const [entitasFilter, setEntitasFilter] = useState("");
  const [selected, setSelected] = useState<AuditLog | null>(null);
  // Peta id → nama supaya UUID di detail bisa dibaca (satuan, lokasi, barang…).
  const [lookups, setLookups] = useState<Lookups | null>(null);

  const fetchLogs = useCallback(async (offset = 0) => {
    if (offset === 0) setLoading(true);
    else setLoadingMore(true);
    const { data, error } = await supabase
      .from("audit_logs")
      .select("*, profiles(email,full_name)")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + AUDIT_PAGE_SIZE - 1);
    if (error) {
      toast.error("Gagal memuat audit log.");
    } else {
      const batch = (data ?? []) as unknown as AuditLog[];
      setHasMore(batch.length === AUDIT_PAGE_SIZE);
      setLogs((prev) => (offset === 0 ? batch : [...prev, ...batch]));
    }
    if (offset === 0) setLoading(false);
    else setLoadingMore(false);
  }, []);

  const fetchAllRemainingLogs = async () => {
    setLoadingMore(true);
    try {
      const rest = await fetchAllPages<AuditLog>((from, to) =>
        supabase
          .from("audit_logs")
          .select("*, profiles(email,full_name)")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(logs.length + from, logs.length + to)
      );
      setLogs((prev) => [...prev, ...rest]);
      setHasMore(false);
    } catch {
      toast.error("Gagal memuat seluruh audit log.");
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    void fetchLogs(0);
  }, [fetchLogs]);

  useEffect(() => {
    (async () => {
      try {
        const [units, cats, locs, sups, items, reqs, profs] = await Promise.all([
          supabase.from("units").select("id, name"),
          supabase.from("asset_categories").select("id, name"),
          supabase.from("locations").select("id, name"),
          supabase.from("suppliers").select("id, name"),
          fetchAllPages<{ id: string; name: string }>((from, to) =>
            supabase.from("inventory_items").select("id, name").order("id").range(from, to)
          ),
          fetchAllPages<{ id: string; request_number: string }>((from, to) =>
            supabase.from("requests").select("id, request_number").order("id").range(from, to)
          ),
          fetchAllPages<{ id: string; email: string }>((from, to) =>
            supabase.from("profiles").select("id, email").order("id").range(from, to)
          ),
        ]);
        const toMap = (rows: unknown, label: string) =>
          new Map(
            ((rows ?? []) as { id: string }[]).map((r) => [
              r.id,
              (r as Record<string, unknown>)[label] as string,
            ]),
          );
        setLookups({
          units: toMap(units.data, "name"),
          categories: toMap(cats.data, "name"),
          locations: toMap(locs.data, "name"),
          suppliers: toMap(sups.data, "name"),
          items: toMap(items, "name"),
          requests: toMap(reqs, "request_number"),
          profiles: toMap(profs, "email"),
        });
      } catch {
        // Biarkan detail log tetap terbuka memakai UUID bila lookup gagal.
      }
    })();
  }, []);

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
        cell: ({ row }) => (
          <Badge variant="secondary" className={badgeDarkClass.secondary}>
            {row.original.action}
          </Badge>
        ),
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
          <Button
            variant="ghost"
            size="sm"
            className="text-ink-300 hover:bg-white/10 hover:text-white"
            onClick={() => setSelected(row.original)}
          >
            <Eye className="mr-1 h-4 w-4" /> Lihat
          </Button>
        ),
      },
    ],
    []
  );

  const action = selected?.action.toUpperCase() ?? "";
  const changed = selected ? diffEntries(selected.old_data, selected.new_data) : [];
  const record =
    selected && action !== "UPDATE"
      ? recordEntries(action === "DELETE" ? selected.old_data : selected.new_data)
      : [];

  return (
    <div>
      <PageHeader
        title="Audit Log"
        description={`Menampilkan ${logs.length.toLocaleString("id-ID")} aktivitas${hasMore ? " terbaru (klik muat lagi untuk melihat riwayat lebih lama)" : ""} — siapa melakukan apa, kapan, dan datanya.`}
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:max-w-2xl">
        <div className="space-y-1.5">
          <Label htmlFor="flt-aksi" className="text-ink-100">Filter aksi</Label>
          <Input
            id="flt-aksi"
            value={aksiFilter}
            onChange={(e) => setAksiFilter(e.target.value)}
            placeholder="cth. create, update, delete…"
            className="border-white/15 bg-white/10 text-white placeholder:text-ink-300"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="flt-entitas" className="text-ink-100">Filter tipe entitas</Label>
          <Input
            id="flt-entitas"
            value={entitasFilter}
            onChange={(e) => setEntitasFilter(e.target.value)}
            placeholder="cth. assets, inventory_items…"
            className="border-white/15 bg-white/10 text-white placeholder:text-ink-300"
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

      {hasMore && !loading && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loadingMore}
            onClick={() => void fetchLogs(logs.length)}
            className="border-white/20 bg-white/10 text-white hover:bg-white/15 hover:text-white"
          >
            {loadingMore ? "Memuat…" : `Muat ${AUDIT_PAGE_SIZE} log lebih lama`}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loadingMore}
            onClick={() => void fetchAllRemainingLogs()}
            className="border-white/20 bg-white/10 text-white hover:bg-white/15 hover:text-white"
          >
            Muat semua riwayat log
          </Button>
        </div>
      )}

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
        {selected && action === "UPDATE" && changed.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Field</TableHead>
                <TableHead>Data Lama</TableHead>
                <TableHead>Data Baru</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {changed.map((d) => (
                <TableRow key={d.key}>
                  <TableCell className="font-medium">{fieldLabel(d.key)}</TableCell>
                  <TableCell className="break-words">{formatValue(d.key, d.old, lookups)}</TableCell>
                  <TableCell className="break-words">{formatValue(d.key, d.next, lookups)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {selected && action === "UPDATE" && changed.length === 0 && (
          <p className="text-sm text-ink-500">
            Tidak ada perubahan isi data — hanya waktu update yang berubah
            {selected.old_data?.updated_at && selected.new_data?.updated_at
              ? ` (${formatDateTime(selected.old_data.updated_at as string)} → ${formatDateTime(selected.new_data.updated_at as string)})`
              : ""}
            .
          </p>
        )}
        {selected && action !== "UPDATE" && record.length > 0 && (
          <>
            <h3 className="mb-2 text-sm font-semibold">
              {action === "DELETE" ? "Data yang dihapus" : "Data baru"}
            </h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Field</TableHead>
                  <TableHead>Nilai</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {record.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell className="font-medium">{fieldLabel(r.key)}</TableCell>
                    <TableCell className="break-words">{formatValue(r.key, r.value, lookups)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </Dialog>
    </div>
  );
}
