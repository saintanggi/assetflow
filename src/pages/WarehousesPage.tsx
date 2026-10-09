import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Pencil, Plus, Power, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { CrudPage } from "../components/CrudPage";
import { DataTable } from "../components/DataTable";
import { PageHeader } from "../components/PageHeader";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select } from "../components/ui/select";
import type { Location, Warehouse } from "../types/database";

type LocationRow = Location & { warehouses: Pick<Warehouse, "code" | "name"> | null };

function LocationsManager() {
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [warehouseId, setWarehouseId] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LocationRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [{ data: locs, error: e1 }, { data: whs }] = await Promise.all([
      supabase
        .from("locations")
        .select("*, warehouses(code,name)")
        .order("name"),
      supabase.from("warehouses").select("*").order("name"),
    ]);
    if (e1) toast.error("Gagal memuat data lokasi.");
    else setLocations((locs ?? []) as LocationRow[]);
    setWarehouses((whs ?? []) as Warehouse[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const openCreate = () => {
    setEditingId(null);
    setWarehouseId("");
    setCode("");
    setName("");
    setIsActive(true);
    setDialogOpen(true);
  };

  const openEdit = (row: LocationRow) => {
    setEditingId(row.id);
    setWarehouseId(row.warehouse_id);
    setCode(row.code);
    setName(row.name);
    setIsActive(row.is_active);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!warehouseId) {
      toast.error("Gudang wajib dipilih.");
      return;
    }
    if (!code.trim()) {
      toast.error("Kode wajib diisi.");
      return;
    }
    if (!name.trim()) {
      toast.error("Nama wajib diisi.");
      return;
    }
    setSaving(true);
    const payload = {
      warehouse_id: warehouseId,
      code: code.trim(),
      name: name.trim(),
      is_active: isActive,
    };
    const { error } = editingId
      ? await supabase.from("locations").update(payload).eq("id", editingId)
      : await supabase.from("locations").insert(payload);
    setSaving(false);
    if (error) {
      toast.error(
        error.code === "23505" ? "Kode sudah dipakai. Gunakan kode lain." : "Gagal menyimpan lokasi."
      );
      return;
    }
    toast.success(editingId ? "Lokasi berhasil diubah." : "Lokasi berhasil ditambah.");
    setDialogOpen(false);
    void fetchAll();
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from("locations").delete().eq("id", deleteTarget.id);
    setDeleting(false);
    if (error) {
      toast.error(
        error.code === "23503"
          ? "Data dipakai di tempat lain, tidak bisa dihapus."
          : "Gagal menghapus lokasi."
      );
      return;
    }
    toast.success("Lokasi berhasil dihapus.");
    setDeleteTarget(null);
    void fetchAll();
  };

  const toggleActive = async (row: LocationRow) => {
    const next = !row.is_active;
    const { error } = await supabase
      .from("locations")
      .update({ is_active: next })
      .eq("id", row.id);
    if (error) {
      toast.error("Gagal mengubah status.");
      return;
    }
    toast.success(next ? "Lokasi diaktifkan." : "Lokasi dinonaktifkan.");
    void fetchAll();
  };

  const columns = useMemo<ColumnDef<LocationRow, unknown>[]>(
    () => [
      { id: "code", header: "Kode", accessorKey: "code" },
      { id: "name", header: "Nama", accessorKey: "name" },
      {
        id: "warehouse",
        header: "Gudang",
        cell: ({ row }) => row.original.warehouses?.name ?? "—",
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge variant={row.original.is_active ? "success" : "secondary"}>
            {row.original.is_active ? "Aktif" : "Nonaktif"}
          </Badge>
        ),
      },
      {
        id: "aksi",
        header: "Aksi",
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" title="Ubah" onClick={() => openEdit(r)}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                title={r.is_active ? "Nonaktifkan" : "Aktifkan"}
                onClick={() => void toggleActive(r)}
              >
                <Power
                  className={`h-4 w-4 ${r.is_active ? "text-amber-300" : "text-emerald-600"}`}
                />
                {r.is_active ? "Nonaktif" : "Aktif"}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                title="Hapus"
                onClick={() => setDeleteTarget(r)}
              >
                <Trash2 className="h-4 w-4 text-rose-400" />
              </Button>
            </div>
          );
        },
      },
    ],
    []
  );

  return (
    <div className="mt-10">
      <PageHeader
        title="Lokasi"
        description="Lokasi penyimpanan di dalam gudang."
        actions={
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> Tambah
          </Button>
        }
      />
      <DataTable
        columns={columns}
        data={locations}
        loading={loading}
        searchPlaceholder="Cari kode, nama, gudang…"
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogHeader>
          <DialogTitle>{editingId ? "Ubah Lokasi" : "Tambah Lokasi"}</DialogTitle>
          <DialogDescription>
            {editingId ? "Perbarui data lokasi." : "Lengkapi data lokasi baru."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="loc-warehouse">
              Gudang <span className="text-rose-400">*</span>
            </Label>
            <Select
              id="loc-warehouse"
              options={warehouses.map((w) => ({ value: w.id, label: `${w.code} — ${w.name}` }))}
              placeholder="Pilih gudang…"
              value={warehouseId}
              onValueChange={setWarehouseId}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="loc-code">
              Kode <span className="text-rose-400">*</span>
            </Label>
            <Input
              id="loc-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="cth. RAK-A1"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="loc-name">
              Nama <span className="text-rose-400">*</span>
            </Label>
            <Input
              id="loc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="cth. Rak A1"
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="loc-active"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            <Label htmlFor="loc-active">Aktif</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
            Batal
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Menyimpan…" : "Simpan"}
          </Button>
        </DialogFooter>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Hapus lokasi?"
        description="Data yang dihapus tidak dapat dikembalikan."
        confirmLabel="Ya, hapus"
        destructive
        loading={deleting}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

export function WarehousesPage() {
  return (
    <div>
      <CrudPage
        title="Gudang"
        description="Kelola gudang penyimpanan."
        table="warehouses"
        searchKeys={["kode", "nama"]}
        allowToggleActive
        columns={[
          { key: "code", label: "Kode" },
          { key: "name", label: "Nama" },
          {
            key: "address",
            label: "Alamat",
            render: (row) => String(row.address ?? "—"),
          },
          {
            key: "is_active",
            label: "Status",
            render: (row) => (
              <Badge variant={Boolean(row.is_active) ? "success" : "secondary"}>
                {Boolean(row.is_active) ? "Aktif" : "Nonaktif"}
              </Badge>
            ),
          },
        ]}
        fields={[
          { name: "code", label: "Kode", type: "text", required: true, placeholder: "cth. WH-JKT" },
          { name: "name", label: "Nama", type: "text", required: true, placeholder: "cth. Gudang Jakarta" },
          { name: "address", label: "Alamat", type: "textarea", placeholder: "Alamat gudang (opsional)" },
          { name: "is_active", label: "Aktif", type: "checkbox" },
        ]}
      />
      <LocationsManager />
    </div>
  );
}
