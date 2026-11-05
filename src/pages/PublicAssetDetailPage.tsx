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
import { PublicHeader } from "../components/PublicHeader";
import { assetConditionVariant, assetStatusVariant } from "../lib/statusColors";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import type { PublicAsset } from "../types/database";
import { ASSET_CONDITION_LABELS, ASSET_STATUS_LABELS } from "../types/database";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
      <div className="mt-1 text-sm text-ink-800">{children}</div>
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
    <div className="relative min-h-screen overflow-x-clip bg-ink-800 bg-[radial-gradient(1000px_480px_at_85%_-10%,rgba(245,158,11,0.14),transparent),radial-gradient(800px_480px_at_0%_110%,rgba(59,130,246,0.12),transparent)]">
      {/* Cahaya latar kaca (oranye + biru) */}
      <div className="animate-drift pointer-events-none fixed -right-24 -top-24 h-96 w-96 rounded-full bg-warn-500/10 blur-3xl" />
      <div className="animate-drift-slow pointer-events-none fixed -bottom-24 -left-24 h-96 w-96 rounded-full bg-info-500/10 blur-3xl" />
      <PublicHeader />
      <div className="animate-page-in relative mx-auto max-w-4xl px-4 py-8">
      <Link
        to="/publik"
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-brand-200 hover:underline"
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
                  className="inline-flex h-10 items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-soft transition-all hover:bg-brand-700"
                >
                  Lihat katalog publik
                </Link>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <PageHeader
            title={asset.name}
            description={`Kode publik: ${asset.public_code}`}
          />
          <Card>
            <CardContent className="p-6 sm:p-8">
              <div className="mb-6 overflow-hidden rounded-xl bg-ink-100">
              {asset.photo_url ? (
                <img
                  src={asset.photo_url}
                  alt={asset.name}
                  className="max-h-96 w-full object-contain"
                />
              ) : (
                <div className="flex aspect-[16/9] w-full items-center justify-center">
                  <ImageOff className="h-12 w-12 text-ink-700" />
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
                  <Badge variant={assetConditionVariant[asset.condition]}>
                    {ASSET_CONDITION_LABELS[asset.condition]}
                  </Badge>
                ) : (
                  "—"
                )}
              </Field>
              <Field label="Status">
                {asset.status ? (
                  <Badge variant={assetStatusVariant[asset.status]}>
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
        </>
      )}
      </div>
    </div>
  );
}
