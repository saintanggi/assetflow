import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ImageOff, PackageSearch } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { formatDate } from "../lib/format";
import { Badge } from "../components/ui/badge";
import { Skeleton } from "../components/ui/skeleton";
import { Card, CardContent } from "../components/ui/card";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import type { AssetCondition, AssetStatus, PublicAsset } from "../types/database";
import { ASSET_CONDITION_LABELS, ASSET_STATUS_LABELS } from "../types/database";

function conditionVariant(condition: AssetCondition | null): "success" | "warning" | "destructive" | "secondary" {
  switch (condition) {
    case "baik":
      return "success";
    case "rusak_ringan":
      return "warning";
    case "rusak_berat":
      return "destructive";
    default:
      return "secondary";
  }
}

function statusVariant(status: AssetStatus | null): "success" | "info" | "warning" | "destructive" | "secondary" {
  switch (status) {
    case "tersedia":
      return "success";
    case "digunakan":
      return "info";
    case "dipinjamkan":
    case "perbaikan":
      return "warning";
    case "rusak":
      return "destructive";
    default:
      return "secondary";
  }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <div className="mt-1 text-sm text-slate-800">{children}</div>
    </div>
  );
}

export function PublicAssetDetailPage() {
  const { publicCode } = useParams<{ publicCode: string }>();
  const [asset, setAsset] = useState<PublicAsset | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!publicCode) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setLoading(true);
      setNotFound(false);
      // HANYA lewat RPC whitelist — tidak pernah query tabel assets langsung.
      // Hasil rpc dinamis (bisa array), diambil elemen pertama bila ada.
      const { data, error } = await supabase.rpc("get_public_asset", {
        p_public_code: publicCode,
      });
      if (cancelled) return;
      if (error) {
        toast.error("Gagal memuat detail aset");
        setNotFound(true);
      } else {
        const rows = (Array.isArray(data) ? data : data ? [data] : []) as PublicAsset[];
        const row = rows[0] ?? null;
        setAsset(row);
        setNotFound(!row);
      }
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [publicCode]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Link
        to="/publik"
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" />
        Kembali ke katalog
      </Link>

      {loading ? (
        <Card>
          <CardContent className="space-y-4 p-6">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="aspect-[16/9] w-full" />
            <div className="grid grid-cols-2 gap-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </CardContent>
        </Card>
      ) : notFound || !asset ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={PackageSearch}
              title="Aset tidak ditemukan"
              description="Aset dengan kode tersebut tidak ada atau belum dipublikasikan."
              action={
                <Link
                  to="/publik"
                  className="inline-flex h-10 items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
                >
                  Lihat katalog publik
                </Link>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-6 sm:p-8">
            <PageHeader
              title={asset.name}
              description={`Kode publik: ${asset.public_code}`}
            />
            <div className="mb-6 overflow-hidden rounded-xl bg-slate-100">
              {asset.photo_url ? (
                <img
                  src={asset.photo_url}
                  alt={asset.name}
                  className="max-h-96 w-full object-contain"
                />
              ) : (
                <div className="flex aspect-[16/9] w-full items-center justify-center">
                  <ImageOff className="h-12 w-12 text-slate-300" />
                </div>
              )}
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Kategori">{asset.category_name ?? "—"}</Field>
              <Field label="Merek">{asset.brand ?? "—"}</Field>
              <Field label="Model">{asset.model ?? "—"}</Field>
              <Field label="Departemen">{asset.department_name ?? "—"}</Field>
              <Field label="Kondisi">
                {asset.condition ? (
                  <Badge variant={conditionVariant(asset.condition)}>
                    {ASSET_CONDITION_LABELS[asset.condition]}
                  </Badge>
                ) : (
                  "—"
                )}
              </Field>
              <Field label="Status">
                {asset.status ? (
                  <Badge variant={statusVariant(asset.status)}>
                    {ASSET_STATUS_LABELS[asset.status]}
                  </Badge>
                ) : (
                  "—"
                )}
              </Field>
              <Field label="Dipublikasikan">{formatDate(asset.published_at)}</Field>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
