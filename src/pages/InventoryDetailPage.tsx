import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Printer, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { supabase } from "../lib/supabase";
import { formatDate, formatDateTime, formatQty, formatRupiah } from "../lib/format";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { EmptyState } from "../components/EmptyState";
import { BarcodeLabel } from "../features/barcodes/BarcodeLabel";
import type {
  InventoryItem,
  InventoryLedger,
  TransactionType,
} from "../types/database";
import { TRANSACTION_TYPE_LABELS } from "../types/database";
import { toast } from "sonner";

const ITEM_SELECT =
  "*, asset_categories(code,name), units(code,name), locations!inventory_items_location_id_fkey(code,name), suppliers(code,name)";

interface BalanceRow {
  item_id: string;
  location_id: string;
  qty: number;
  locations?: {
    code: string;
    name: string;
    warehouses?: { name: string } | null;
  } | null;
}

interface LedgerRow extends InventoryLedger {
  inventory_transactions?: {
    doc_number: string;
    type: TransactionType;
  } | null;
}

export function InventoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      const { data, error } = await supabase
        .from("inventory_items")
        .select(ITEM_SELECT)
        .eq("id", id)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        toast.error("Barang tidak ditemukan", {
          description: error?.message ?? "Periksa kembali SKU barang.",
        });
        navigate("/persediaan", { replace: true });
        return;
      }
      const it = data as InventoryItem;
      setItem(it);

      const [balRes, ledRes] = await Promise.all([
        supabase
          .from("inventory_balances")
          .select("*, locations(code,name,warehouses(name))")
          .eq("item_id", it.id)
          .order("qty", { ascending: false }),
        supabase
          .from("inventory_ledger")
          .select("*, inventory_transactions(doc_number,type)")
          .eq("item_id", it.id)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      if (cancelled) return;
      if (balRes.error) {
        toast.error("Gagal memuat stok per lokasi", {
          description: balRes.error.message,
        });
      } else {
        setBalances((balRes.data ?? []) as BalanceRow[]);
      }
      if (ledRes.error) {
        toast.error("Gagal memuat kartu stok", {
          description: ledRes.error.message,
        });
      } else {
        setLedger((ledRes.data ?? []) as LedgerRow[]);
      }
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id, navigate]);

  const totalStock = useMemo(
    () => balances.reduce((sum, b) => sum + Number(b.qty), 0),
    [balances]
  );

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!item) return null;

  const infoRows: { label: string; value: string }[] = [
    { label: "SKU", value: item.sku },
    { label: "Barcode", value: item.barcode ?? "—" },
    { label: "Nama", value: item.name },
    { label: "Kategori", value: item.asset_categories?.name ?? "—" },
    {
      label: "Satuan",
      value: item.units ? `${item.units.code} — ${item.units.name}` : "—",
    },
    { label: "Merek", value: item.brand ?? "—" },
    { label: "Model", value: item.model ?? "—" },
    { label: "Stok Minimum", value: formatQty(item.min_stock) },
    { label: "Total Stok", value: formatQty(totalStock) },
    { label: "Harga Beli", value: formatRupiah(item.purchase_price) },
    { label: "Lokasi Default", value: item.locations?.name ?? "—" },
    { label: "Pemasok", value: item.suppliers?.name ?? "—" },
    { label: "Dibuat", value: formatDate(item.created_at) },
  ];

  return (
    <div>
      <PageHeader
        title={item.name}
        description={`SKU: ${item.sku}`}
        actions={
          <>
            <Button variant="outline" onClick={() => navigate("/persediaan")}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Kembali
            </Button>
            <Button variant="outline" onClick={() => navigate(`/label?sku=${item.id}`)}>
              <Printer className="mr-2 h-4 w-4" /> Cetak Barcode
            </Button>
            <Button variant="outline" onClick={() => navigate("/transaksi/masuk")}>
              <ArrowDownToLine className="mr-2 h-4 w-4" /> Barang Masuk
            </Button>
            <Button onClick={() => navigate("/transaksi/keluar")}>
              <ArrowUpFromLine className="mr-2 h-4 w-4" /> Barang Keluar
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Informasi Barang</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
              {infoRows.map((r) => (
                <div key={r.label} className="flex flex-col">
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    {r.label}
                  </dt>
                  <dd className="mt-0.5 text-sm font-medium text-slate-100">{r.value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-6">
              {item.is_active ? (
                <Badge variant="success">Aktif</Badge>
              ) : (
                <Badge variant="secondary">Nonaktif</Badge>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Barcode</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-3">
            {item.photo_url ? (
              <img
                src={item.photo_url}
                alt={item.name}
                className="h-32 w-full rounded-lg border object-cover"
              />
            ) : null}
            <BarcodeLabel
              value={item.sku || item.barcode || ""}
              fileName={item.sku}
            />
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Stok per Lokasi</CardTitle>
        </CardHeader>
        <CardContent>
          {balances.length === 0 ? (
            <EmptyState
              title="Belum ada stok"
              description="Barang ini belum memiliki stok di lokasi mana pun."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lokasi</TableHead>
                  <TableHead>Gudang</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {balances.map((b) => (
                  <TableRow key={b.location_id}>
                    <TableCell>{b.locations?.name ?? "—"}</TableCell>
                    <TableCell>{b.locations?.warehouses?.name ?? "—"}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatQty(b.qty)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-semibold">
                  <TableCell colSpan={2}>Total</TableCell>
                  <TableCell className="text-right">{formatQty(totalStock)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Kartu Stok</CardTitle>
        </CardHeader>
        <CardContent>
          {ledger.length === 0 ? (
            <EmptyState
              title="Belum ada mutasi"
              description="Belum ada transaksi yang menyentuh barang ini."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Waktu</TableHead>
                  <TableHead>No. Dokumen</TableHead>
                  <TableHead>Jenis</TableHead>
                  <TableHead className="text-right">Perubahan</TableHead>
                  <TableHead className="text-right">Stok Akhir</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledger.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(l.created_at)}
                    </TableCell>
                    <TableCell>
                      {l.inventory_transactions?.doc_number ?? "—"}
                    </TableCell>
                    <TableCell>
                      {l.inventory_transactions
                        ? TRANSACTION_TYPE_LABELS[l.inventory_transactions.type]
                        : "—"}
                    </TableCell>
                    <TableCell
                      className={`text-right font-medium ${
                        Number(l.qty_change) >= 0 ? "text-emerald-600" : "text-rose-400"
                      }`}
                    >
                      {Number(l.qty_change) >= 0 ? "+" : ""}
                      {formatQty(l.qty_change)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatQty(l.qty_after)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
