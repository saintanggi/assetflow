import { useEffect, useState } from "react";
import { Download, Printer } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import {
  formatDate,
  formatDateTime,
  formatQty,
  formatRupiah,
} from "../lib/format";
import { exportToCsv } from "../lib/csv";
import {
  ASSET_CONDITION_LABELS,
  ASSET_STATUS_LABELS,
  TRANSACTION_TYPE_LABELS,
  type AssetCondition,
  type AssetStatus,
  type TransactionType,
} from "../types/database";
import { DataTable } from "../components/DataTable";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select } from "../components/ui/select";
import { cn } from "../lib/utils";

type Tab = "aset" | "stok" | "menipis" | "kartu" | "transaksi" | "nilai";

const TABS: { id: Tab; label: string }[] = [
  { id: "aset", label: "Aset" },
  { id: "stok", label: "Stok" },
  { id: "menipis", label: "Stok Menipis" },
  { id: "kartu", label: "Kartu Stok" },
  { id: "transaksi", label: "Transaksi" },
  { id: "nilai", label: "Nilai Aset" },
];

interface AssetRow {
  id: string;
  asset_code: string;
  name: string;
  category_id: string | null;
  location_id: string | null;
  condition: AssetCondition;
  status: AssetStatus;
  purchase_price: number | null;
  asset_categories: { name: string | null } | null;
  locations: { name: string | null } | null;
  departments: { name: string | null } | null;
}

interface StockRow {
  id: string;
  sku: string;
  name: string;
  category_id: string | null;
  min_stock: number | null;
  units: { code: string | null } | null;
  asset_categories: { name: string | null } | null;
  total: number;
}

interface LedgerRow {
  id: string;
  created_at: string;
  qty_change: number;
  qty_after: number;
  inventory_transactions: {
    doc_number: string;
    type: TransactionType;
    transaction_date: string;
  } | null;
}

interface TxRow {
  id: string;
  doc_number: string;
  type: TransactionType;
  status: string;
  transaction_date: string;
  reference: string | null;
}

interface Opt {
  id: string;
  code: string;
  name: string;
}

function firstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function ReportsPage() {
  const { isSuperAdmin, hasPermission } = useAuth();
  const canExport = hasPermission("reports.export");

  const [tab, setTab] = useState<Tab>("aset");
  const [loading, setLoading] = useState(false);

  // Filter bersama
  const [dateFrom, setDateFrom] = useState(firstOfMonth());
  const [dateTo, setDateTo] = useState(todayStr());
  const [categoryId, setCategoryId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [status, setStatus] = useState("");
  const [txType, setTxType] = useState("");
  const [kartuItemId, setKartuItemId] = useState("");

  // Opsi filter
  const [categories, setCategories] = useState<Opt[]>([]);
  const [locations, setLocations] = useState<Opt[]>([]);
  const [items, setItems] = useState<Opt[]>([]);

  // Data per tab
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [stocks, setStocks] = useState<StockRow[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [txs, setTxs] = useState<TxRow[]>([]);

  // Opsi filter (sekali muat)
  useEffect(() => {
    (async () => {
      const [{ data: cats }, { data: locs }, { data: itms }] = await Promise.all([
        supabase.from("asset_categories").select("id, code, name").order("name"),
        supabase.from("locations").select("id, code, name").order("name"),
        supabase.from("inventory_items").select("id, sku, name").order("sku"),
      ]);
      setCategories((cats ?? []) as Opt[]);
      setLocations((locs ?? []) as Opt[]);
      setItems(
        (((itms ?? []) as { id: string; sku: string; name: string }[]).map((i) => ({
          id: i.id,
          code: i.sku,
          name: i.name,
        })) as Opt[])
      );
    })();
  }, []);

  // Muat data sesuai tab & filter
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        if (tab === "aset" || tab === "nilai") {
          let q = supabase
            .from("assets")
            .select(
              "id, asset_code, name, category_id, location_id, condition, status, purchase_price, asset_categories(name), locations(name), departments(name)"
            )
            .order("asset_code");
          if (categoryId) q = q.eq("category_id", categoryId);
          if (locationId) q = q.eq("location_id", locationId);
          if (status) q = q.eq("status", status);
          const { data, error } = await q;
          if (error) throw error;
          if (!cancelled) setAssets((data ?? []) as unknown as AssetRow[]);
        } else if (tab === "stok" || tab === "menipis") {
          let q = supabase
            .from("inventory_items")
            .select("id, sku, name, category_id, min_stock, units(code), asset_categories(name)")
            .order("sku");
          if (categoryId) q = q.eq("category_id", categoryId);
          const { data: itemData, error } = await q;
          if (error) throw error;
          const { data: balData } = await supabase
            .from("inventory_balances")
            .select("item_id, qty");
          const totals = new Map<string, number>();
          for (const b of (balData ?? []) as { item_id: string; qty: number }[]) {
            totals.set(b.item_id, (totals.get(b.item_id) ?? 0) + Number(b.qty));
          }
          let rows = ((itemData ?? []) as unknown as StockRow[]).map((i) => ({
            ...i,
            total: totals.get(i.id) ?? 0,
          }));
          if (tab === "menipis") {
            rows = rows.filter(
              (r) => r.min_stock != null && Number(r.min_stock) > 0 && r.total < Number(r.min_stock)
            );
          }
          if (!cancelled) setStocks(rows);
        } else if (tab === "kartu") {
          if (!kartuItemId) {
            if (!cancelled) setLedger([]);
            setLoading(false);
            return;
          }
          let q = supabase
            .from("inventory_ledger")
            .select(
              "id, created_at, qty_change, qty_after, inventory_transactions(doc_number, type, transaction_date)"
            )
            .eq("item_id", kartuItemId)
            .order("created_at", { ascending: true });
          if (dateFrom) q = q.gte("created_at", `${dateFrom}T00:00:00`);
          if (dateTo) q = q.lte("created_at", `${dateTo}T23:59:59`);
          const { data, error } = await q;
          if (error) throw error;
          if (!cancelled) setLedger((data ?? []) as unknown as LedgerRow[]);
        } else if (tab === "transaksi") {
          let q = supabase
            .from("inventory_transactions")
            .select("id, doc_number, type, status, transaction_date, reference")
            .order("transaction_date", { ascending: false });
          if (dateFrom) q = q.gte("transaction_date", dateFrom);
          if (dateTo) q = q.lte("transaction_date", dateTo);
          if (txType) q = q.eq("type", txType);
          const { data, error } = await q;
          if (error) throw error;
          if (!cancelled) setTxs((data ?? []) as TxRow[]);
        }
      } catch {
        if (!cancelled) toast.error("Gagal memuat laporan.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, categoryId, locationId, status, txType, kartuItemId, dateFrom, dateTo]);

  const handleExport = () => {
    if (tab === "aset") {
      const rows = assets.map((a) => ({
        Kode: a.asset_code,
        Nama: a.name,
        Kategori: a.asset_categories?.name ?? "",
        Lokasi: a.locations?.name ?? "",
        Departemen: a.departments?.name ?? "",
        Kondisi: ASSET_CONDITION_LABELS[a.condition] ?? a.condition,
        Status: ASSET_STATUS_LABELS[a.status] ?? a.status,
        ...(isSuperAdmin ? { "Harga Perolehan": a.purchase_price ?? "" } : {}),
      }));
      exportToCsv("laporan-aset", rows);
    } else if (tab === "stok" || tab === "menipis") {
      exportToCsv(
        tab === "stok" ? "laporan-stok" : "laporan-stok-menipis",
        stocks.map((s) => ({
          SKU: s.sku,
          Nama: s.name,
          Kategori: s.asset_categories?.name ?? "",
          Satuan: s.units?.code ?? "",
          "Stok Min": s.min_stock ?? "",
          Total: s.total,
          ...(tab === "menipis" ? { Selisih: s.total - Number(s.min_stock ?? 0) } : {}),
        }))
      );
    } else if (tab === "kartu") {
      exportToCsv(
        "kartu-stok",
        ledger.map((l) => ({
          Tanggal: formatDateTime(l.created_at),
          "No. Dokumen": l.inventory_transactions?.doc_number ?? "",
          Tipe: l.inventory_transactions
            ? TRANSACTION_TYPE_LABELS[l.inventory_transactions.type]
            : "",
          Perubahan: l.qty_change,
          "Stok Akhir": l.qty_after,
        }))
      );
    } else if (tab === "transaksi") {
      exportToCsv(
        "laporan-transaksi",
        txs.map((t) => ({
          Tanggal: formatDate(t.transaction_date),
          "No. Dokumen": t.doc_number,
          Tipe: TRANSACTION_TYPE_LABELS[t.type] ?? t.type,
          Status: t.status,
          Referensi: t.reference ?? "",
        }))
      );
    } else if (tab === "nilai") {
      const byCat = new Map<string, number>();
      const byDept = new Map<string, number>();
      for (const a of assets) {
        const price = Number(a.purchase_price ?? 0);
        const cat = a.asset_categories?.name ?? "Tanpa kategori";
        const dept = a.departments?.name ?? "Tanpa departemen";
        byCat.set(cat, (byCat.get(cat) ?? 0) + price);
        byDept.set(dept, (byDept.get(dept) ?? 0) + price);
      }
      const rows = [
        ...[...byCat.entries()].map(([label, total]) => ({
          Kelompok: "Kategori",
          Label: label,
          "Total Nilai": total,
        })),
        ...[...byDept.entries()].map(([label, total]) => ({
          Kelompok: "Departemen",
          Label: label,
          "Total Nilai": total,
        })),
      ];
      exportToCsv("laporan-nilai-aset", rows);
    }
    toast.success("File CSV diunduh.");
  };

  const nilaiByCat = new Map<string, number>();
  const nilaiByDept = new Map<string, number>();
  for (const a of assets) {
    const price = Number(a.purchase_price ?? 0);
    nilaiByCat.set(
      a.asset_categories?.name ?? "Tanpa kategori",
      (nilaiByCat.get(a.asset_categories?.name ?? "Tanpa kategori") ?? 0) + price
    );
    nilaiByDept.set(
      a.departments?.name ?? "Tanpa departemen",
      (nilaiByDept.get(a.departments?.name ?? "Tanpa departemen") ?? 0) + price
    );
  }

  return (
    <div>
      <PageHeader
        title="Laporan"
        description="Rekap aset, stok, transaksi, dan nilai aset."
        actions={
          <>
            {canExport && (
              <Button variant="outline" onClick={handleExport}>
                <Download className="mr-2 h-4 w-4" /> Ekspor CSV
              </Button>
            )}
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" /> Cetak
            </Button>
          </>
        }
      />

      {/* Tab */}
      <div className="mb-6 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Button
            key={t.id}
            variant={tab === t.id ? "default" : "outline"}
            size="sm"
            onClick={() => setTab(t.id)}
            className={cn(tab === t.id && "pointer-events-none")}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {/* Filter bersama */}
      <div className="mb-6 grid grid-cols-1 gap-3 rounded-xl border border-white/10 bg-ink-850 p-4 sm:grid-cols-2 lg:grid-cols-5">
        {(tab === "kartu" || tab === "transaksi") && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="flt-from">Dari</Label>
              <Input
                id="flt-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="flt-to">Sampai</Label>
              <Input
                id="flt-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </>
        )}
        {(tab === "aset" || tab === "stok" || tab === "menipis") && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="flt-cat">Kategori</Label>
              <Select
                id="flt-cat"
                options={categories.map((c) => ({ value: c.id, label: c.name }))}
                placeholder="Semua kategori"
                value={categoryId}
                onValueChange={setCategoryId}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="flt-loc">Lokasi</Label>
              <Select
                id="flt-loc"
                options={locations.map((l) => ({
                  value: l.id,
                  label: `${l.code} — ${l.name}`,
                }))}
                placeholder="Semua lokasi"
                value={locationId}
                onValueChange={setLocationId}
              />
            </div>
          </>
        )}
        {tab === "aset" && (
          <div className="space-y-1.5">
            <Label htmlFor="flt-status">Status</Label>
            <Select
              id="flt-status"
              options={Object.entries(ASSET_STATUS_LABELS).map(([v, l]) => ({
                value: v,
                label: l,
              }))}
              placeholder="Semua status"
              value={status}
              onValueChange={setStatus}
            />
          </div>
        )}
        {tab === "transaksi" && (
          <div className="space-y-1.5">
            <Label htmlFor="flt-tipe">Tipe</Label>
            <Select
              id="flt-tipe"
              options={Object.entries(TRANSACTION_TYPE_LABELS).map(([v, l]) => ({
                value: v,
                label: l,
              }))}
              placeholder="Semua tipe"
              value={txType}
              onValueChange={setTxType}
            />
          </div>
        )}
        {tab === "kartu" && (
          <div className="space-y-1.5 lg:col-span-2">
            <Label htmlFor="flt-sku">SKU Barang</Label>
            <Select
              id="flt-sku"
              options={items.map((i) => ({ value: i.id, label: `${i.code} — ${i.name}` }))}
              placeholder="Pilih barang…"
              value={kartuItemId}
              onValueChange={setKartuItemId}
            />
          </div>
        )}
      </div>

      {/* Isi tab */}
      {tab === "aset" && (
        <DataTable
          loading={loading}
          searchPlaceholder="Cari kode, nama…"
          pageSize={15}
          columns={[
            { id: "kode", header: "Kode", accessorKey: "asset_code" },
            { id: "nama", header: "Nama", accessorKey: "name" },
            {
              id: "kategori",
              header: "Kategori",
              cell: ({ row }) => row.original.asset_categories?.name ?? "—",
            },
            {
              id: "lokasi",
              header: "Lokasi",
              cell: ({ row }) => row.original.locations?.name ?? "—",
            },
            {
              id: "kondisi",
              header: "Kondisi",
              cell: ({ row }) => ASSET_CONDITION_LABELS[row.original.condition] ?? "—",
            },
            {
              id: "status",
              header: "Status",
              cell: ({ row }) => (
                <Badge variant="secondary">
                  {ASSET_STATUS_LABELS[row.original.status] ?? "—"}
                </Badge>
              ),
            },
            ...(isSuperAdmin
              ? [
                  {
                    id: "harga",
                    header: "Harga Perolehan",
                    cell: ({ row }: { row: { original: AssetRow } }) => (
                      <span className="whitespace-nowrap">
                        {formatRupiah(row.original.purchase_price)}
                      </span>
                    ),
                  },
                ]
              : []),
          ]}
          data={assets}
        />
      )}

      {(tab === "stok" || tab === "menipis") && (
        <DataTable
          loading={loading}
          searchPlaceholder="Cari SKU, nama…"
          pageSize={15}
          columns={[
            { id: "sku", header: "SKU", accessorKey: "sku" },
            { id: "nama", header: "Nama", accessorKey: "name" },
            {
              id: "kategori",
              header: "Kategori",
              cell: ({ row }) => row.original.asset_categories?.name ?? "—",
            },
            {
              id: "satuan",
              header: "Satuan",
              cell: ({ row }) => row.original.units?.code ?? "—",
            },
            {
              id: "min",
              header: "Stok Min",
              cell: ({ row }) => formatQty(row.original.min_stock),
            },
            {
              id: "total",
              header: "Total Stok",
              cell: ({ row }) => (
                <span
                  className={
                    row.original.min_stock != null &&
                    Number(row.original.min_stock) > 0 &&
                    row.original.total < Number(row.original.min_stock)
                      ? "font-semibold text-rose-400"
                      : "font-semibold"
                  }
                >
                  {formatQty(row.original.total)}
                </span>
              ),
            },
          ]}
          data={stocks}
        />
      )}

      {tab === "kartu" && (
        <DataTable
          loading={loading}
          searchPlaceholder="Cari no. dokumen…"
          pageSize={15}
          columns={[
            {
              id: "tgl",
              header: "Tanggal",
              cell: ({ row }) => formatDateTime(row.original.created_at),
            },
            {
              id: "doc",
              header: "No. Dokumen",
              cell: ({ row }) => row.original.inventory_transactions?.doc_number ?? "—",
            },
            {
              id: "tipe",
              header: "Tipe",
              cell: ({ row }) =>
                row.original.inventory_transactions
                  ? TRANSACTION_TYPE_LABELS[row.original.inventory_transactions.type]
                  : "—",
            },
            {
              id: "ubah",
              header: "Perubahan",
              cell: ({ row }) => (
                <span
                  className={row.original.qty_change >= 0 ? "text-emerald-600" : "text-rose-400"}
                >
                  {row.original.qty_change >= 0 ? "+" : ""}
                  {formatQty(row.original.qty_change)}
                </span>
              ),
            },
            {
              id: "akhir",
              header: "Stok Akhir",
              cell: ({ row }) => formatQty(row.original.qty_after),
            },
          ]}
          data={ledger}
          emptyTitle={kartuItemId ? "Tidak ada data" : "Pilih barang dulu"}
          emptyDescription={
            kartuItemId
              ? "Belum ada mutasi pada periode ini."
              : "Pilih SKU barang pada filter di atas untuk melihat kartu stok."
          }
        />
      )}

      {tab === "transaksi" && (
        <DataTable
          loading={loading}
          searchPlaceholder="Cari no. dokumen, referensi…"
          pageSize={15}
          columns={[
            {
              id: "tgl",
              header: "Tanggal",
              cell: ({ row }) => formatDate(row.original.transaction_date),
            },
            { id: "doc", header: "No. Dokumen", accessorKey: "doc_number" },
            {
              id: "tipe",
              header: "Tipe",
              cell: ({ row }) => (
                <Badge variant="info">{TRANSACTION_TYPE_LABELS[row.original.type]}</Badge>
              ),
            },
            {
              id: "status",
              header: "Status",
              cell: ({ row }) => <Badge variant="secondary">{row.original.status}</Badge>,
            },
            {
              id: "ref",
              header: "Referensi",
              cell: ({ row }) => row.original.reference ?? "—",
            },
          ]}
          data={txs}
        />
      )}

      {tab === "nilai" &&
        (isSuperAdmin ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <h2 className="mb-3 text-sm font-semibold text-white">Per Kategori</h2>
              <DataTable
                loading={loading}
                searchPlaceholder="Cari kategori…"
                columns={[
                  { id: "label", header: "Kategori", accessorKey: "label" },
                  {
                    id: "total",
                    header: "Total Nilai",
                    cell: ({ row }) => formatRupiah(row.original.total),
                  },
                ]}
                data={[...nilaiByCat.entries()].map(([label, total]) => ({ label, total }))}
              />
            </div>
            <div>
              <h2 className="mb-3 text-sm font-semibold text-white">Per Departemen</h2>
              <DataTable
                loading={loading}
                searchPlaceholder="Cari departemen…"
                columns={[
                  { id: "label", header: "Departemen", accessorKey: "label" },
                  {
                    id: "total",
                    header: "Total Nilai",
                    cell: ({ row }) => formatRupiah(row.original.total),
                  },
                ]}
                data={[...nilaiByDept.entries()].map(([label, total]) => ({ label, total }))}
              />
            </div>
          </div>
        ) : (
          <EmptyState
            title="Akses terbatas"
            description="Laporan nilai aset membutuhkan akses Super Admin."
          />
        ))}
    </div>
  );
}
