import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, Upload } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select } from "../components/ui/select";
import { Checkbox } from "../components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import { assetSchema } from "../schemas/asset";
import type {
  Asset,
  AssetCategory,
  AssetCondition,
  AssetStatus,
  Department,
  Location,
} from "../types/database";
import { ASSET_STATUS_LABELS, ASSET_CONDITION_LABELS } from "../types/database";
import { toast } from "sonner";

const CONDITION_OPTIONS: { value: AssetCondition; label: string }[] = (
  Object.keys(ASSET_CONDITION_LABELS) as AssetCondition[]
).map((v) => ({ value: v, label: ASSET_CONDITION_LABELS[v] }));

const STATUS_OPTIONS: { value: AssetStatus; label: string }[] = (
  Object.keys(ASSET_STATUS_LABELS) as AssetStatus[]
).map((v) => ({ value: v, label: ASSET_STATUS_LABELS[v] }));

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * assetSchema (kontrak) belum memuat public_code, padahal kolomnya wajib unik
 * di DB — jadi skema diperluas lokal di halaman ini, bukan di file kontrak.
 */
const assetFormSchema = assetSchema.extend({
  public_code: z
    .string()
    .min(1, "Kode publik wajib diisi")
    .max(60, "Kode publik maksimal 60 karakter")
    .regex(/^[a-z0-9-]+$/, "Kode publik hanya boleh huruf kecil, angka, dan -"),
});

/** z.input (bukan z.infer): skema memakai .default() sehingga tipe input
 *  (is_published?: boolean) berbeda dari output — pola resmi react-hook-form. */
type AssetPageFormValues = z.input<typeof assetFormSchema>;

interface LocationRow extends Location {
  warehouses?: { code: string; name: string } | null;
}

export function AssetFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { isSuperAdmin, hasPermission } = useAuth();
  // Catatan: izin "assets.publish" ditegakkan di backend khusus untuk super admin
  // (RLS/policy). Checkbox publikasi hanya tampil di UI bila user super admin
  // ATAU punya izin tersebut.
  const canPublish = isSuperAdmin || hasPermission("assets.publish");

  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [publicTouched, setPublicTouched] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<AssetPageFormValues>({
    resolver: zodResolver(assetFormSchema),
    defaultValues: {
      asset_code: "",
      public_code: "",
      name: "",
      category_id: null,
      brand: null,
      model: null,
      serial_number: null,
      purchase_date: null,
      purchase_price: null,
      location_id: null,
      department_id: null,
      custodian: null,
      condition: "baik",
      status: "tersedia",
      photo_url: null,
      is_published: false,
    },
  });

  const assetCode = watch("asset_code");

  // public_code otomatis mengikuti asset_code (bisa diubah manual).
  useEffect(() => {
    if (isEdit || publicTouched) return;
    setValue("public_code", slugify(assetCode ?? ""), { shouldValidate: true });
  }, [assetCode, isEdit, publicTouched, setValue]);

  useEffect(() => {
    let cancelled = false;
    async function loadMasters() {
      const [cats, locs, depts] = await Promise.all([
        supabase
          .from("asset_categories")
          .select("*")
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("locations")
          .select("*, warehouses(code,name)")
          .eq("is_active", true)
          .order("name"),
        supabase.from("departments").select("*").order("name"),
      ]);
      if (cancelled) return;
      setCategories((cats.data ?? []) as AssetCategory[]);
      setLocations((locs.data ?? []) as LocationRow[]);
      setDepartments((depts.data ?? []) as Department[]);
    }
    async function loadAsset() {
      if (!id) return;
      setLoading(true);
      const { data, error } = await supabase
        .from("assets")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        toast.error("Aset tidak ditemukan", {
          description: error?.message ?? undefined,
        });
        navigate("/aset", { replace: true });
        return;
      }
      const a = data as Asset;
      reset({
        asset_code: a.asset_code,
        public_code: a.public_code,
        name: a.name,
        category_id: a.category_id,
        brand: a.brand,
        model: a.model,
        serial_number: a.serial_number,
        purchase_date: a.purchase_date,
        purchase_price: a.purchase_price,
        location_id: a.location_id,
        department_id: a.department_id,
        custodian: a.custodian,
        condition: a.condition,
        status: a.status,
        photo_url: a.photo_url,
        is_published: a.is_published,
      });
      setPhotoPreview(a.photo_url);
      setPublicTouched(true); // saat edit, pertahankan public_code apa adanya
      setLoading(false);
    }
    void loadMasters();
    void loadAsset();
    return () => {
      cancelled = true;
    };
  }, [id, navigate, reset]);

  const onPhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) {
      setPhotoFile(null);
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("File harus berupa gambar (image/*).");
      e.target.value = "";
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      toast.error("Ukuran foto maksimal 5 MB.");
      e.target.value = "";
      return;
    }
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const uploadPhoto = async (code: string): Promise<string | null> => {
    if (!photoFile) return photoPreview;
    const safeName = photoFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `assets/${code}/${Date.now()}-${safeName}`;
    const { error } = await supabase.storage
      .from("asset-photos")
      .upload(path, photoFile, { upsert: true });
    if (error) throw new Error(error.message);
    const { data } = supabase.storage.from("asset-photos").getPublicUrl(path);
    return data.publicUrl;
  };

  const checkDuplicate = async (
    field: "asset_code" | "public_code",
    value: string
  ): Promise<boolean> => {
    let q = supabase
      .from("assets")
      .select("id", { count: "exact", head: true })
      .eq(field, value);
    if (id) q = q.neq("id", id);
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    return (count ?? 0) > 0;
  };

  const onSubmit = async (values: AssetPageFormValues) => {
    setSaving(true);
    try {
      if (await checkDuplicate("asset_code", values.asset_code)) {
        toast.error("Kode aset sudah dipakai", {
          description: `Kode "${values.asset_code}" sudah terdaftar. Gunakan kode lain.`,
        });
        setSaving(false);
        return;
      }
      if (await checkDuplicate("public_code", values.public_code)) {
        toast.error("Kode publik sudah dipakai", {
          description: `Kode publik "${values.public_code}" sudah terdaftar. Gunakan kode lain.`,
        });
        setSaving(false);
        return;
      }

      const photoUrl = await uploadPhoto(values.asset_code);

      const payload = {
        asset_code: values.asset_code,
        public_code: values.public_code,
        name: values.name,
        category_id: values.category_id ?? null,
        brand: values.brand || null,
        model: values.model || null,
        serial_number: values.serial_number || null,
        purchase_date: values.purchase_date || null,
        purchase_price: values.purchase_price ?? null,
        location_id: values.location_id ?? null,
        department_id: values.department_id ?? null,
        custodian: values.custodian || null,
        condition: values.condition,
        status: values.status,
        photo_url: photoUrl,
        is_published: values.is_published ?? false,
      };

      if (isEdit && id) {
        const { error } = await supabase.from("assets").update(payload).eq("id", id);
        if (error) throw new Error(error.message);
        toast.success("Aset berhasil diubah");
        navigate(`/aset/${id}`);
      } else {
        const { data, error } = await supabase
          .from("assets")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        toast.success("Aset berhasil ditambahkan");
        navigate(`/aset/${(data as { id: string }).id}`);
      }
    } catch (err) {
      toast.error("Gagal menyimpan aset", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const fieldError = (name: keyof AssetPageFormValues): string | undefined =>
    errors[name]?.message as string | undefined;

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const locationOptions = locations.map((l) => ({
    value: l.id,
    label: l.warehouses ? `${l.warehouses.name} — ${l.name}` : l.name,
  }));

  return (
    <div>
      <PageHeader
        title={isEdit ? "Ubah Aset" : "Tambah Aset"}
        description={
          isEdit
            ? "Perbarui data aset. Kode publik dipertahankan apa adanya."
            : "Isi data aset baru. Kode publik terisi otomatis dari kode aset dan bisa diubah."
        }
        actions={
          <Button
            variant="outline"
            onClick={() => navigate(isEdit && id ? `/aset/${id}` : "/aset")}
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> Kembali
          </Button>
        }
      />

      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Data Aset</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="asset_code">Kode Aset *</Label>
                <Input id="asset_code" {...register("asset_code")} placeholder="AST-0001" />
                {fieldError("asset_code") && (
                  <p className="mt-1 text-xs text-red-600">{fieldError("asset_code")}</p>
                )}
              </div>
              <div>
                <Label htmlFor="public_code">Kode Publik *</Label>
                <Input
                  id="public_code"
                  {...register("public_code", {
                    onChange: () => setPublicTouched(true),
                  })}
                  placeholder="ast-0001"
                />
                {fieldError("public_code") && (
                  <p className="mt-1 text-xs text-red-600">{fieldError("public_code")}</p>
                )}
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="name">Nama Aset *</Label>
                <Input id="name" {...register("name")} placeholder="Laptop Dell Latitude 5440" />
                {fieldError("name") && (
                  <p className="mt-1 text-xs text-red-600">{fieldError("name")}</p>
                )}
              </div>
              <div>
                <Label htmlFor="category_id">Kategori</Label>
                <Select
                  id="category_id"
                  placeholder="Pilih kategori"
                  options={categories.map((c) => ({ value: c.id, label: c.name }))}
                  {...register("category_id", {
                    setValueAs: (v: string) => (v === "" ? null : v),
                  })}
                />
                {fieldError("category_id") && (
                  <p className="mt-1 text-xs text-red-600">{fieldError("category_id")}</p>
                )}
              </div>
              <div>
                <Label htmlFor="location_id">Lokasi</Label>
                <Select
                  id="location_id"
                  placeholder="Pilih gudang — lokasi"
                  options={locationOptions}
                  {...register("location_id", {
                    setValueAs: (v: string) => (v === "" ? null : v),
                  })}
                />
                {fieldError("location_id") && (
                  <p className="mt-1 text-xs text-red-600">{fieldError("location_id")}</p>
                )}
              </div>
              <div>
                <Label htmlFor="brand">Merek</Label>
                <Input id="brand" {...register("brand")} placeholder="Dell" />
              </div>
              <div>
                <Label htmlFor="model">Model</Label>
                <Input id="model" {...register("model")} placeholder="Latitude 5440" />
              </div>
              <div>
                <Label htmlFor="serial_number">Nomor Seri</Label>
                <Input id="serial_number" {...register("serial_number")} />
              </div>
              <div>
                <Label htmlFor="custodian">Penanggung Jawab</Label>
                <Input id="custodian" {...register("custodian")} placeholder="Nama pemegang aset" />
              </div>
              <div>
                <Label htmlFor="purchase_date">Tanggal Beli</Label>
                <Input
                  id="purchase_date"
                  type="date"
                  {...register("purchase_date", {
                    setValueAs: (v: string) => (v === "" ? null : v),
                  })}
                />
              </div>
              <div>
                <Label htmlFor="purchase_price">Harga Beli (Rp)</Label>
                <Input
                  id="purchase_price"
                  type="number"
                  min={0}
                  placeholder="0"
                  {...register("purchase_price", {
                    setValueAs: (v: string) => (v === "" ? null : Number(v)),
                  })}
                />
                {fieldError("purchase_price") && (
                  <p className="mt-1 text-xs text-red-600">{fieldError("purchase_price")}</p>
                )}
              </div>
              <div>
                <Label htmlFor="department_id">Departemen</Label>
                <Select
                  id="department_id"
                  placeholder="Pilih departemen"
                  options={departments.map((d) => ({ value: d.id, label: d.name }))}
                  {...register("department_id", {
                    setValueAs: (v: string) => (v === "" ? null : v),
                  })}
                />
              </div>
              <div>
                <Label htmlFor="condition">Kondisi *</Label>
                <Select
                  id="condition"
                  options={CONDITION_OPTIONS}
                  {...register("condition")}
                />
              </div>
              <div>
                <Label htmlFor="status">Status *</Label>
                <Select id="status" options={STATUS_OPTIONS} {...register("status")} />
              </div>
              {canPublish && (
                <div className="flex items-center gap-2 sm:col-span-2">
                  <Checkbox id="is_published" {...register("is_published")} />
                  <Label htmlFor="is_published" className="font-normal">
                    Publikasikan (halaman publik dapat diakses via QR code)
                  </Label>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Foto Aset</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {photoPreview && (
                  <img
                    src={photoPreview}
                    alt="Pratinjau foto aset"
                    className="h-40 w-full rounded-lg border object-cover"
                  />
                )}
                <Label
                  htmlFor="photo"
                  className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-600 hover:bg-slate-50"
                >
                  <Upload className="h-4 w-4" />
                  {photoFile ? photoFile.name : "Pilih foto (opsional, maks 5 MB)"}
                </Label>
                <Input
                  id="photo"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onPhotoChange}
                />
                <p className="text-xs text-slate-500">
                  Format gambar apa pun, ukuran maksimal 5 MB.
                </p>
              </CardContent>
            </Card>

            <Button type="submit" className="w-full" disabled={saving}>
              {saving ? "Menyimpan…" : isEdit ? "Simpan Perubahan" : "Tambah Aset"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
