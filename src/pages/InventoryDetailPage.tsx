import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowDownToLine, ArrowUpFromLine, Pencil } from "lucide-react";
import { supabase } from "../lib/supabase";
import { formatDate, formatDateTime, formatQty, formatRupiah } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select } from "../components/ui/select";
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
import { EmptyState } from "../components/EmptyState";
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
  const { isSuperAdmin } = useAuth();
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);

  // State edit master (superadmin).
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [units, setUnits] = useState<{ id: string; code: string; name: string }[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState({
    name: "",
    sku: "",
    barcode: "",
    category_id: "",
    unit_id: "",
    brand: "",
    model: "",
    min_stock: "",
    purchase_price: "",
    supplier_id: "",
    photo_url: "",
    is_active: true,
  });
  const [uploading, setUploading] = useState(false);

  const openEdit = async () => {
    if (!item) return;
    setForm({
      name: item.name ?? "",
      sku: item.sku ?? "",
      barcode: item.barcode ?? "",
      category_id: item.category_id ?? "",
      unit_id: item.unit_id ?? "",
      brand: item.brand ?? "",
      model: item.model ?? "",
      min_stock: String(item.min_stock ?? 0),
      purchase_price: item.purchase_price != null ? String(item.purchase_price) : "",
      supplier_id: item.supplier_id ?? "",
      photo_url: item.photo_url ?? "",
      is_active: item.is_active ?? true,
    });
    setEditOpen(true);
    const [c, u, s] = await Promise.all([
      supabase.from("asset_categories").select("id, name").order("name"),
      supabase.from("units").select("id, code, name").order("code"),
      supabase.from("suppliers").select("id, name").order("name"),
    ]);
    setCategories((c.data ?? []) as { id: string; name: string }[]);
    setUnits((u.data ?? []) as { id: string; code: string; name: string }[]);
    setSuppliers((s.data ?? []) as { id: string; name: string }[]);
  };

  const saveEdit = async () => {
    if (!item) return;
    if (!form.name.trim()) {
      toast.error("Nama barang wajib diisi.");
      return;
    }
    if (!form.unit_id) {
      toast.error("Satuan wajib dipilih.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("inventory_items")
        .update({
          name: form.name.trim(),
          sku: form.sku.trim() || item.sku,
          barcode: form.barcode.trim() || null,
          category_id: form.category_id || null,
          unit_id: form.unit_id,
          brand: form.brand.trim() || null,
          model: form.model.trim() || null,
          min_stock: Number(form.min_stock) || 0,
          purchase_price: form.purchase_price === "" ? null : Number(form.purchase_price),
          supplier_id: form.supplier_id || null,
          photo_url: form.photo_url.trim() || null,
          is_active: form.is_active,
        })
        .eq("id", item.id);
      if (error) throw new Error(error.message);
      toast.success("Master barang diperbarui.");
      setEditOpen(false);
      // Muat ulang.
      const { data } = await supabase.from("inventory_items").select(ITEM_SELECT).eq("id", item.id).maybeSingle();
      if (data) setItem(data as InventoryItem);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan.");
    } finally {
      setSaving(false);
    }
  };

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
    { label: "Nama", value: item.name },
    { label: "Kategori", value: item.asset_categories?.name ?? "—" },
    {
      label: "Satuan",
      value: item.units ? item.units.code.toUpperCase() : "—",
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
        description={item.brand ? `Merek: ${item.brand}` : "Detail barang persediaan"}
        actions={
          <>
            <Button variant="outline" onClick={() => navigate("/persediaan")}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Kembali
            </Button>
            {isSuperAdmin && (
              <Button variant="outline" onClick={openEdit}>
                <Pencil className="mr-2 h-4 w-4" /> Ubah Master
              </Button>
            )}
            <Button variant="outline" onClick={() => navigate("/transaksi/masuk")}>
              <ArrowDownToLine className="mr-2 h-4 w-4" /> Barang Masuk
            </Button>
            <Button onClick={() => navigate("/transaksi/keluar")}>
              <ArrowUpFromLine className="mr-2 h-4 w-4" /> Barang Keluar
            </Button>
          </>
        }
      />

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Informasi Barang</CardTitle>
          </CardHeader>
          <CardContent>
            {item.photo_url ? (
              <img
                src={item.photo_url}
                alt={item.name}
                className="mb-4 h-40 w-full rounded-lg border object-cover"
              />
            ) : null}
            <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
              {infoRows.map((r) => (
                <div key={r.label} className="flex flex-col">
                  <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                    {r.label}
                  </dt>
                  <dd className="mt-0.5 text-sm font-medium text-ink-800">{r.value}</dd>
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
                        Number(l.qty_change) >= 0 ? "text-ok-600" : "text-brand-600"
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

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogHeader>
          <DialogTitle>Ubah Master Barang</DialogTitle>
          <DialogDescription>
            Hanya superadmin yang dapat mengubah master barang.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Nama Barang *</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>SKU</Label>
            <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Barcode</Label>
            <Input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} placeholder="Otomatis = SKU bila kosong" />
          </div>
          <div className="space-y-1.5">
            <Label>Kategori</Label>
            <Select
              value={form.category_id}
              onValueChange={(v) => setForm({ ...form, category_id: v })}
              placeholder="Pilih kategori"
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Satuan *</Label>
            <Select
              value={form.unit_id}
              onValueChange={(v) => setForm({ ...form, unit_id: v })}
              placeholder="Pilih satuan"
              options={units.map((u) => ({ value: u.id, label: u.code.toUpperCase() }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Merek</Label>
            <Input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Model</Label>
            <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Stok Minimum (Buffer)</Label>
            <Input type="number" min="0" value={form.min_stock} onChange={(e) => setForm({ ...form, min_stock: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Harga Beli</Label>
            <Input type="number" min="0" value={form.purchase_price} onChange={(e) => setForm({ ...form, purchase_price: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Pemasok</Label>
            <Select
              value={form.supplier_id}
              onValueChange={(v) => setForm({ ...form, supplier_id: v })}
              placeholder="Pilih pemasok"
              options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Foto Barang</Label>
            {form.photo_url && (
              <img src={form.photo_url} alt="Foto barang" className="h-24 w-24 rounded-lg object-cover" />
            )}
            <Input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              disabled={uploading}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 5 * 1024 * 1024) {
                  toast.error("Ukuran file maksimal 5MB.");
                  return;
                }
                setUploading(true);
                try {
                  const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
                  const path = `${item.id}/${Date.now()}.${ext}`;
                  const { error: upErr } = await supabase.storage
                    .from("item-photos")
                    .upload(path, file, { upsert: true, contentType: file.type });
                  if (upErr) throw new Error(upErr.message);
                  const { data } = supabase.storage.from("item-photos").getPublicUrl(path);
                  setForm({ ...form, photo_url: data.publicUrl });
                  toast.success("Foto terupload.");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Gagal upload foto.");
                } finally {
                  setUploading(false);
                }
              }}
            />
            {uploading && <p className="text-xs text-ink-500">Mengupload…</p>}
          </div>
          <label className="flex cursor-pointer items-center gap-2 sm:col-span-2">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
            />
            <span className="text-sm text-ink-800">Aktif</span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setEditOpen(false)}>Batal</Button>
          <Button onClick={saveEdit} disabled={saving}>{saving ? "Menyimpan…" : "Simpan"}</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
