import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ImageOff, PackageSearch, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { formatDate } from "../lib/format";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { Badge } from "../components/ui/badge";
import { Skeleton } from "../components/ui/skeleton";
import { Card, CardContent } from "../components/ui/card";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import type {
  AssetCategory,
  AssetCondition,
  AssetStatus,
  PublicAsset,
} from "../types/database";
import { ASSET_CONDITION_LABELS, ASSET_STATUS_LABELS } from "../types/database";

const PAGE_SIZE = 24;

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

export function PublicDashboardPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [kategori, setKategori] = useState("");
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [assets, setAssets] = useState<PublicAsset[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 400);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    async function loadCategories() {
      const { data, error } = await supabase
        .from("asset_categories")
        .select("id, code, name")
        .eq("is_active", true)
        .order("name");
      if (cancelled) return;
      if (error) {
        toast.error("Gagal memuat daftar kategori");
        return;
      }
      setCategories((data ?? []) as AssetCategory[]);
    }
    void loadCategories();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadAssets() {
      setLoading(true);
      // HANYA lewat RPC whitelist — tidak pernah query tabel assets langsung.
      const { data, error } = await supabase.rpc("search_public_assets", {
        p_query: debouncedQ || null,
        p_category: kategori || null,
        p_limit: PAGE_SIZE,
        p_offset: 0,
      });
      if (cancelled) return;
      if (error) {
        toast.error("Gagal memuat katalog aset");
        setAssets([]);
      } else {
        setAssets((data ?? []) as PublicAsset[]);
      }
      setLoading(false);
    }
    void loadAssets();
    return () => {
      cancelled = true;
    };
  }, [debouncedQ, kategori]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <PageHeader
        title="Katalog Aset Publik"
        description="Daftar aset yang dipublikasikan. Klik kartu untuk melihat detail."
      />

      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari nama, merek, atau model aset…"
            className="pl-9"
          />
        </div>
        <div className="w-full sm:w-64">
          <Select
            placeholder="Semua kategori"
            value={kategori}
            onValueChange={setKategori}
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
          />
        </div>
      </div>

      {loading ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="space-y-3 p-4">
                <Skeleton className="aspect-[4/3] w-full" />
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : assets.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title="Tidak ada aset ditemukan"
          description="Coba ubah kata kunci pencarian atau filter kategori."
        />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {assets.map((asset) => (
            <Card
              key={asset.public_code}
              className="cursor-pointer overflow-hidden transition-shadow hover:shadow-lg"
              onClick={() => navigate(`/publik/aset/${encodeURIComponent(asset.public_code)}`)}
            >
              <div className="aspect-[4/3] w-full bg-slate-100">
                {asset.photo_url ? (
                  <img
                    src={asset.photo_url}
                    alt={asset.name}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <ImageOff className="h-10 w-10 text-slate-300" />
                  </div>
                )}
              </div>
              <CardContent className="space-y-2 p-4">
                <h3 className="line-clamp-1 font-semibold text-navy-900">{asset.name}</h3>
                <p className="line-clamp-1 text-sm text-slate-500">
                  {asset.category_name ?? "Tanpa kategori"}
                  {[asset.brand, asset.model].filter(Boolean).length > 0 &&
                    ` • ${[asset.brand, asset.model].filter(Boolean).join(" ")}`}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {asset.condition && (
                    <Badge variant={conditionVariant(asset.condition)}>
                      {ASSET_CONDITION_LABELS[asset.condition]}
                    </Badge>
                  )}
                  {asset.status && (
                    <Badge variant={statusVariant(asset.status)}>
                      {ASSET_STATUS_LABELS[asset.status]}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center justify-between pt-1 text-xs text-slate-400">
                  <span>{asset.department_name ?? "—"}</span>
                  <span>{formatDate(asset.published_at)}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
