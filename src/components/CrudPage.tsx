import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Pencil, Plus, Power, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select } from "./ui/select";
import { Textarea } from "./ui/textarea";
import { ConfirmDialog } from "./ConfirmDialog";
import { DataTable } from "./DataTable";
import { PageHeader } from "./PageHeader";

export interface CrudField {
  name: string;
  label: string;
  type: "text" | "textarea" | "checkbox" | "select";
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
}

export interface CrudColumn {
  key: string;
  label: string;
  render?: (row: Record<string, unknown>) => ReactNode;
}

export interface CrudPageProps {
  title: string;
  description?: string;
  table: string;
  columns: CrudColumn[];
  fields: CrudField[];
  searchKeys: string[];
  orderBy?: string;
  allowToggleActive?: boolean;
}

type FormState = Record<string, string | boolean>;
type Row = Record<string, unknown>;

function emptyForm(fields: CrudField[]): FormState {
  const state: FormState = {};
  for (const f of fields) state[f.name] = f.type === "checkbox" ? false : "";
  return state;
}

function formFromRow(fields: CrudField[], row: Row): FormState {
  const state: FormState = {};
  for (const f of fields) {
    const v = row[f.name];
    state[f.name] = f.type === "checkbox" ? Boolean(v) : v == null ? "" : String(v);
  }
  return state;
}

/** Halaman CRUD generik untuk master data sederhana. */
export function CrudPage({
  title,
  description,
  table,
  columns,
  fields,
  searchKeys,
  orderBy,
  allowToggleActive = false,
}: CrudPageProps) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm(fields));
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order(orderBy ?? "name");
    if (error) {
      toast.error("Gagal memuat data.");
    } else {
      setRows((data ?? []) as Row[]);
    }
    setLoading(false);
  }, [table, orderBy]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  const setField = (name: string, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [name]: value }));

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm(fields));
    setDialogOpen(true);
  };

  const openEdit = (row: Row) => {
    setEditingId(String(row.id));
    setForm(formFromRow(fields, row));
    setDialogOpen(true);
  };

  const handleSave = async () => {
    for (const f of fields) {
      if (f.required) {
        const v = form[f.name];
        const kosong = f.type === "checkbox" ? v !== true : String(v ?? "").trim() === "";
        if (kosong) {
          toast.error(`${f.label} wajib diisi.`);
          return;
        }
      }
    }
    setSaving(true);
    const payload: Record<string, string | boolean> = { ...form };
    const { error } = editingId
      ? await supabase.from(table).update(payload).eq("id", editingId)
      : await supabase.from(table).insert(payload);
    setSaving(false);
    if (error) {
      toast.error(
        error.code === "23505"
          ? "Kode sudah dipakai. Gunakan kode lain."
          : "Gagal menyimpan data."
      );
      return;
    }
    toast.success(editingId ? "Data berhasil diubah." : "Data berhasil ditambah.");
    setDialogOpen(false);
    void fetchRows();
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from(table).delete().eq("id", String(deleteTarget.id));
    setDeleting(false);
    if (error) {
      toast.error(
        error.code === "23503"
          ? "Data dipakai di tempat lain, tidak bisa dihapus."
          : "Gagal menghapus data."
      );
      return;
    }
    toast.success("Data berhasil dihapus.");
    setDeleteTarget(null);
    void fetchRows();
  };

  const toggleActive = async (row: Row) => {
    const next = !Boolean(row.is_active);
    const { error } = await supabase
      .from(table)
      .update({ is_active: next })
      .eq("id", String(row.id));
    if (error) {
      toast.error("Gagal mengubah status.");
      return;
    }
    toast.success(next ? "Data diaktifkan." : "Data dinonaktifkan.");
    void fetchRows();
  };

  const tableColumns = useMemo<ColumnDef<Row, unknown>[]>(() => {
    const cols: ColumnDef<Row, unknown>[] = columns.map((c) => ({
      id: c.key,
      header: c.label,
      accessorKey: c.key,
      cell: ({ row }) =>
        c.render ? c.render(row.original) : String(row.original[c.key] ?? "—"),
    }));
    cols.push({
      id: "aksi",
      header: "Aksi",
      cell: ({ row }) => {
        const r = row.original;
        const aktif = Boolean(r.is_active);
        return (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" title="Ubah" onClick={() => openEdit(r)}>
              <Pencil className="h-4 w-4" />
            </Button>
            {allowToggleActive && "is_active" in r && (
              <Button
                variant="ghost"
                size="sm"
                title={aktif ? "Nonaktifkan" : "Aktifkan"}
                onClick={() => void toggleActive(r)}
              >
                <Power className={`h-4 w-4 ${aktif ? "text-amber-300" : "text-emerald-600"}`} />
                {aktif ? "Nonaktif" : "Aktif"}
              </Button>
            )}
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
    });
    return cols;
  }, [columns, allowToggleActive]);

  return (
    <div>
      <PageHeader
        title={title}
        description={description}
        actions={
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> Tambah
          </Button>
        }
      />

      <DataTable
        columns={tableColumns}
        data={rows}
        loading={loading}
        searchPlaceholder={`Cari ${searchKeys.join(", ")}…`}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogHeader>
          <DialogTitle>{editingId ? `Ubah ${title}` : `Tambah ${title}`}</DialogTitle>
          <DialogDescription>
            {editingId ? "Perbarui data di bawah ini." : "Lengkapi data baru di bawah ini."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {fields.map((f) => {
            const id = `crud-${table}-${f.name}`;
            const label = (
              <Label htmlFor={id}>
                {f.label}
                {f.required && <span className="text-rose-400"> *</span>}
              </Label>
            );
            return (
              <div key={f.name} className="space-y-1.5">
                {f.type === "checkbox" ? (
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={id}
                      checked={form[f.name] === true}
                      onChange={(e) => setField(f.name, e.target.checked)}
                    />
                    {label}
                  </div>
                ) : (
                  <>
                    {label}
                    {f.type === "textarea" ? (
                      <Textarea
                        id={id}
                        rows={3}
                        value={String(form[f.name] ?? "")}
                        onChange={(e) => setField(f.name, e.target.value)}
                        placeholder={f.placeholder}
                      />
                    ) : f.type === "select" ? (
                      <Select
                        id={id}
                        options={f.options ?? []}
                        placeholder={f.placeholder ?? "Pilih…"}
                        value={String(form[f.name] ?? "")}
                        onValueChange={(v) => setField(f.name, v)}
                      />
                    ) : (
                      <Input
                        id={id}
                        value={String(form[f.name] ?? "")}
                        onChange={(e) => setField(f.name, e.target.value)}
                        placeholder={f.placeholder}
                      />
                    )}
                  </>
                )}
              </div>
            );
          })}
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
        title="Hapus data?"
        description="Data yang dihapus tidak dapat dikembalikan."
        confirmLabel="Ya, hapus"
        destructive
        loading={deleting}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
