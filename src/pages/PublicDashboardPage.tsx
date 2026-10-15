import { useEffect, useState } from "react";
import { ImageOff, PackageSearch, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { Badge } from "../components/ui/badge";
import { Skeleton } from "../components/ui/skeleton";
import { Card, CardContent } from "../components/ui/card";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import type {
  AssetCategory,
  PublicInventoryItem,
} from "../types/database";

const PAGE_SIZE = 24;

export function PublicDashboardPage() {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [kategori, setKategori] = useState("");
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [assets, setAssets] = useState<PublicInventoryItem[]>([]);
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
      // Katalog publik master barang (inventory_items) via RPC whitelist.
      const { data, error } = await supabase.rpc("search_public_inventory", {
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
        setAssets((data ?? []) as PublicInventoryItem[]);
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
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
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
              key={asset.sku}
              className="overflow-hidden transition-shadow hover:shadow-lg"
            >
              <div className="aspect-[4/3] w-full bg-ink-100">
                {asset.photo_url ? (
                  <img
                    src={asset.photo_url}
                    alt={asset.name}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <ImageOff className="h-10 w-10 text-ink-700" />
                  </div>
                )}
              </div>
              <CardContent className="space-y-2 p-4">
                <h3 className="line-clamp-1 font-semibold text-white">{asset.name}</h3>
                <p className="line-clamp-1 text-sm text-ink-500">
                  {asset.category ?? "Tanpa kategori"}
                  {[asset.brand, asset.model].filter(Boolean).length > 0 &&
                    ` • ${[asset.brand, asset.model].filter(Boolean).join(" ")}`}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="secondary" className="font-mono text-xs">
                    {asset.sku}
                  </Badge>
                  {asset.unit && (
                    <Badge variant="outline" className="text-xs">
                      {asset.unit}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center justify-between pt-1 text-xs text-ink-500">
                  <span>Stok: <b className="text-white">{Number(asset.total_stock).toLocaleString("id-ID")}</b></span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
