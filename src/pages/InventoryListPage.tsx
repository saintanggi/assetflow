import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { formatQty } from "../lib/format";
import { DataTable } from "../components/DataTable";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select } from "../components/ui/select";
import { Checkbox } from "../components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { inventoryItemSchema } from "../schemas/inventory";

/** z.input: skema memakai .default() (is_active) sehingga tipe input berbeda
 *  dari output — pola resmi react-hook-form + zodResolver. */
type InventoryPageFormValues = z.input<typeof inventoryItemSchema>;
import type {
  AssetCategory,
  InventoryBalance,
  InventoryItem,
  Location,
  Supplier,
  Unit,
} from "../types/database";
import { toast } from "sonner";

const ITEM_SELECT = "*, asset_categories(code,name), units(code,name)";

type StockStatus = "habis" | "menipis" | "aman";

interface ItemRow extends InventoryItem {
  total_stock: number;
  stock_status: StockStatus;
}

interface LocationRow extends Location {
  warehouses?: { code: string; name: string } | null;
}

export function InventoryListPage() {
  const { hasPermission } = useAuth();
  const [items, setItems] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [saving, setSaving] = useState(false);

  const loadItems = async () => {
    setLoading(true);
    const [{ data: itemData, error: itemError }, { data: balData, error: balError }] =
      await Promise.all([
        supabase.from("inventory_items").select(ITEM_SELECT).order("name"),
        supabase.from("inventory_balances").select("item_id, qty"),
      ]);
    if (itemError || balError) {
      toast.error("Gagal memuat persediaan", {
        description: itemError?.message ?? balError?.message,
      });
      setItems([]);
    } else {
      const totals = new Map<string, number>();
      for (const b of (balData ?? []) as Pick<InventoryBalance, "item_id" | "qty">[]) {
        totals.set(b.item_id, (totals.get(b.item_id) ?? 0) + Number(b.qty));
      }
      const rows: ItemRow[] = ((itemData ?? []) as InventoryItem[]).map((it) => {
        const total = totals.get(it.id) ?? 0;
        const min = it.min_stock ?? 0;
        const status: StockStatus =
          total <= 0 ? "habis" : total < min ? "menipis" : "aman";
        return { ...it, total_stock: total, stock_status: status };
      });
      setItems(rows);
    }
    setLoading(false);
  };

  useEffect(() => {
    void loadItems();
    // master data untuk dialog tambah barang
    void (async () => {
      const [cats, uns, locs, sups] = await Promise.all([
        supabase.from("asset_categories").select("*").eq("is_active", true).order("name"),
        supabase.from("units").select("*").order("name"),
        supabase
          .from("locations")
          .select("*, warehouses(code,name)")
          .eq("is_active", true)
          .order("name"),
        supabase.from("suppliers").select("*").order("name"),
      ]);
      setCategories((cats.data ?? []) as AssetCategory[]);
      setUnits((uns.data ?? []) as Unit[]);
      setLocations((locs.data ?? []) as LocationRow[]);
      setSuppliers((sups.data ?? []) as Supplier[]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InventoryPageFormValues>({
    resolver: zodResolver(inventoryItemSchema),
    defaultValues: {
      sku: "",
      name: "",
      category_id: null,
      brand: null,
      model: null,
      unit_id: null,
      barcode: null,
      min_stock: null,
      location_id: null,
      supplier_id: null,
      purchase_price: null,
      is_active: true,
      photo_url: null,
    },
  });

  const fieldError = (name: keyof InventoryPageFormValues): string | undefined =>
    errors[name]?.message as string | undefined;

  const onAddItem = async (values: InventoryPageFormValues) => {
    setSaving(true);
    try {
      const { count } = await supabase
        .from("inventory_items")
        .select("id", { count: "exact", head: true })
        .eq("sku", values.sku);
      if ((count ?? 0) > 0) {
        toast.error("SKU sudah dipakai", {
          description: `SKU "${values.sku}" sudah terdaftar.`,
        });
        setSaving(false);
        return;
      }
      const { error } = await supabase.from("inventory_items").insert({
        sku: values.sku,
        name: values.name,
        category_id: values.category_id ?? null,
        brand: values.brand || null,
        model: values.model || null,
        unit_id: values.unit_id ?? null,
        barcode: values.barcode || null,
        min_stock: values.min_stock ?? null,
        location_id: values.location_id ?? null,
        supplier_id: values.supplier_id ?? null,
        purchase_price: values.purchase_price ?? null,
        is_active: values.is_active ?? true,
      });
      if (error) throw new Error(error.message);
      toast.success("Barang berhasil ditambahkan");
      setDialogOpen(false);
      reset();
      await loadItems();
    } catch (err) {
      toast.error("Gagal menambah barang", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const stockBadge = (row: ItemRow) => {
    switch (row.stock_status) {
      case "habis":
        return <Badge variant="destructive">Habis</Badge>;
      case "menipis":
        return <Badge variant="warning">Menipis</Badge>;
      default:
        return <Badge variant="success">Aman</Badge>;
    }
  };

  const columns: ColumnDef<ItemRow>[] = useMemo(
    () => [
      {
        header: "SKU",
        accessorKey: "sku",
        cell: ({ row }) => (
          <Link
            to={`/persediaan/${row.original.id}`}
            className="font-medium text-brand-300 hover:underline"
          >
            {row.original.sku}
          </Link>
        ),
      },
      { header: "Nama", accessorKey: "name" },
      {
        header: "Kategori",
        cell: ({ row }) => row.original.asset_categories?.name ?? "—",
      },
      {
        header: "Satuan",
        cell: ({ row }) =>
          row.original.units ? `${row.original.units.code} — ${row.original.units.name}` : "—",
      },
      {
        header: "Total Stok",
        accessorKey: "total_stock",
        cell: ({ row }) => formatQty(row.original.total_stock),
      },
      {
        header: "Stok Min",
        accessorKey: "min_stock",
        cell: ({ row }) => formatQty(row.original.min_stock),
      },
      {
        header: "Status Stok",
        accessorKey: "stock_status",
        cell: ({ row }) => stockBadge(row.original),
      },
      {
        header: "Aktif",
        accessorKey: "is_active",
        cell: ({ row }) =>
          row.original.is_active ? (
            <Badge variant="success">Ya</Badge>
          ) : (
            <Badge variant="secondary">Tidak</Badge>
          ),
      },
    ],
    []
  );

  return (
    <div>
      <PageHeader
        title="Persediaan"
        description="Daftar barang persediaan beserta total stok di semua lokasi."
        actions={
          hasPermission("inventory.receive") ? (
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Tambah
            </Button>
          ) : undefined
        }
      />
      <DataTable
        columns={columns}
        data={items}
        loading={loading}
        searchPlaceholder="Cari SKU atau nama barang…"
        pageSize={15}
        emptyTitle="Tidak ada barang"
        emptyDescription="Belum ada barang persediaan yang terdaftar."
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogHeader>
          <DialogTitle>Tambah Barang</DialogTitle>
          <DialogDescription>
            Daftarkan barang persediaan baru. Stok awal diisi lewat menu Barang Masuk.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onAddItem)}>
          <div className="grid gap-4 px-1 py-2 sm:grid-cols-2">
            <div>
              <Label htmlFor="inv-sku">SKU *</Label>
              <Input id="inv-sku" {...register("sku")} placeholder="BRG-0001" />
              {fieldError("sku") && (
                <p className="mt-1 text-xs text-rose-400">{fieldError("sku")}</p>
              )}
            </div>
            <div>
              <Label htmlFor="inv-barcode">Barcode</Label>
              <Input id="inv-barcode" {...register("barcode")} placeholder="Opsional" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="inv-name">Nama Barang *</Label>
              <Input id="inv-name" {...register("name")} placeholder="Kabel UTP Cat6" />
              {fieldError("name") && (
                <p className="mt-1 text-xs text-rose-400">{fieldError("name")}</p>
              )}
            </div>
            <div>
              <Label htmlFor="inv-category">Kategori</Label>
              <Select
                id="inv-category"
                placeholder="Pilih kategori"
                options={categories.map((c) => ({ value: c.id, label: c.name }))}
                {...register("category_id", {
                  setValueAs: (v: string) => (v === "" ? null : v),
                })}
              />
            </div>
            <div>
              <Label htmlFor="inv-unit">Satuan</Label>
              <Select
                id="inv-unit"
                placeholder="Pilih satuan"
                options={units.map((u) => ({ value: u.id, label: `${u.code} — ${u.name}` }))}
                {...register("unit_id", {
                  setValueAs: (v: string) => (v === "" ? null : v),
                })}
              />
            </div>
            <div>
              <Label htmlFor="inv-brand">Merek</Label>
              <Input id="inv-brand" {...register("brand")} />
            </div>
            <div>
              <Label htmlFor="inv-model">Model</Label>
              <Input id="inv-model" {...register("model")} />
            </div>
            <div>
              <Label htmlFor="inv-min">Stok Minimum</Label>
              <Input
                id="inv-min"
                type="number"
                min={0}
                placeholder="0"
                {...register("min_stock", {
                  setValueAs: (v: string) => (v === "" ? null : Number(v)),
                })}
              />
              {fieldError("min_stock") && (
                <p className="mt-1 text-xs text-rose-400">{fieldError("min_stock")}</p>
              )}
            </div>
            <div>
              <Label htmlFor="inv-price">Harga Beli (Rp)</Label>
              <Input
                id="inv-price"
                type="number"
                min={0}
                placeholder="0"
                {...register("purchase_price", {
                  setValueAs: (v: string) => (v === "" ? null : Number(v)),
                })}
              />
              {fieldError("purchase_price") && (
                <p className="mt-1 text-xs text-rose-400">{fieldError("purchase_price")}</p>
              )}
            </div>
            <div>
              <Label htmlFor="inv-location">Lokasi Default</Label>
              <Select
                id="inv-location"
                placeholder="Pilih lokasi"
                options={locations.map((l) => ({
                  value: l.id,
                  label: l.warehouses ? `${l.warehouses.name} — ${l.name}` : l.name,
                }))}
                {...register("location_id", {
                  setValueAs: (v: string) => (v === "" ? null : v),
                })}
              />
            </div>
            <div>
              <Label htmlFor="inv-supplier">Pemasok</Label>
              <Select
                id="inv-supplier"
                placeholder="Pilih pemasok"
                options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
                {...register("supplier_id", {
                  setValueAs: (v: string) => (v === "" ? null : v),
                })}
              />
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <Checkbox id="inv-active" {...register("is_active")} />
              <Label htmlFor="inv-active" className="font-normal">
                Barang aktif (bisa dipakai transaksi)
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              Batal
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Menyimpan…" : "Simpan"}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </div>
  );
}
