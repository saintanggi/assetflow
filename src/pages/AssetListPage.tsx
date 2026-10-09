import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Pencil, Eye } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { DataTable } from "../components/DataTable";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import type {
  Asset,
  AssetCondition,
  AssetStatus,
} from "../types/database";
import { ASSET_STATUS_LABELS, ASSET_CONDITION_LABELS } from "../types/database";
import { toast } from "sonner";

const ASSET_SELECT =
  "*, asset_categories(code,name), locations(code,name,warehouses(code,name)), departments(code,name)";

const STATUS_VARIANT: Record<AssetStatus, "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info"> = {
  tersedia: "success",
  digunakan: "info",
  dipinjamkan: "warning",
  perbaikan: "warning",
  rusak: "destructive",
  dipensiunkan: "secondary",
};

const CONDITION_VARIANT: Record<AssetCondition, "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info"> = {
  baik: "success",
  rusak_ringan: "warning",
  rusak_berat: "destructive",
};

export function AssetListPage() {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);

  const q = (searchParams.get("q") ?? "").trim().toLowerCase();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const { data, error } = await supabase
        .from("assets")
        .select(ASSET_SELECT)
        .eq("archived", false)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (error) {
        toast.error("Gagal memuat daftar aset", { description: error.message });
        setAssets([]);
      } else {
        setAssets((data ?? []) as Asset[]);
      }
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!q) return assets;
    return assets.filter(
      (a) =>
        a.asset_code.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.public_code.toLowerCase().includes(q)
    );
  }, [assets, q]);

  const columns: ColumnDef<Asset>[] = useMemo(
    () => [
      {
        header: "Kode",
        accessorKey: "asset_code",
        cell: ({ row }) => (
          <Link
            to={`/aset/${row.original.id}`}
            className="font-medium text-brand-700 hover:underline"
          >
            {row.original.asset_code}
          </Link>
        ),
      },
      {
        header: "Nama",
        accessorKey: "name",
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.name}</div>
            <div className="text-xs text-slate-500">
              {row.original.brand ?? ""}
              {row.original.brand && row.original.model ? " · " : ""}
              {row.original.model ?? ""}
            </div>
          </div>
        ),
      },
      {
        header: "Kategori",
        accessorKey: "asset_categories.name",
        cell: ({ row }) => row.original.asset_categories?.name ?? "—",
      },
      {
        header: "Lokasi",
        cell: ({ row }) => {
          const loc = row.original.locations;
          if (!loc) return "—";
          const wh = loc.warehouses?.name ?? loc.warehouses?.code;
          return wh ? `${wh} — ${loc.name}` : loc.name;
        },
      },
      {
        header: "Kondisi",
        accessorKey: "condition",
        cell: ({ row }) => (
          <Badge variant={CONDITION_VARIANT[row.original.condition]}>
            {ASSET_CONDITION_LABELS[row.original.condition]}
          </Badge>
        ),
      },
      {
        header: "Status",
        accessorKey: "status",
        cell: ({ row }) => (
          <Badge variant={STATUS_VARIANT[row.original.status]}>
            {ASSET_STATUS_LABELS[row.original.status]}
          </Badge>
        ),
      },
      {
        header: "Publik",
        accessorKey: "is_published",
        cell: ({ row }) =>
          row.original.is_published ? (
            <Badge variant="success">Ya</Badge>
          ) : (
            <Badge variant="secondary">Tidak</Badge>
          ),
      },
      {
        header: "Aksi",
        id: "aksi",
        cell: ({ row }) => (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(`/aset/${row.original.id}`)}
            >
              <Eye className="mr-1 h-4 w-4" /> Lihat
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(`/aset/${row.original.id}/ubah`)}
            >
              <Pencil className="mr-1 h-4 w-4" /> Ubah
            </Button>
          </div>
        ),
      },
    ],
    [navigate]
  );

  return (
    <div>
      <PageHeader
        title="Daftar Aset"
        description={
          q
            ? `Hasil pencarian global untuk "${searchParams.get("q")}" — ${filtered.length} aset`
            : "Kelola seluruh aset yang aktif (belum diarsipkan)."
        }
        actions={
          hasPermission("assets.create") ? (
            <Button onClick={() => navigate("/aset/tambah")}>
              <Plus className="mr-2 h-4 w-4" /> Tambah Aset
            </Button>
          ) : undefined
        }
      />
      <DataTable
        columns={columns}
        data={filtered}
        loading={loading}
        searchPlaceholder="Cari kode, nama, atau kode publik…"
        pageSize={15}
        emptyTitle="Tidak ada aset"
        emptyDescription={
          q
            ? "Tidak ada aset yang cocok dengan pencarian."
            : "Belum ada aset yang terdaftar."
        }
      />
    </div>
  );
}
