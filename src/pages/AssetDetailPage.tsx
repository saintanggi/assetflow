import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Pencil, Archive, ArchiveRestore, Globe, Globe2, Printer, ArrowLeft } from "lucide-react";
import { supabase, publicAssetUrl } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { formatDate, formatDateTime, formatRupiah } from "../lib/format";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { QrLabel } from "../features/barcodes/QrLabel";
import type { Asset, AssetMovement, AssetStatus } from "../types/database";
import { ASSET_STATUS_LABELS, ASSET_CONDITION_LABELS } from "../types/database";
import { toast } from "sonner";

const ASSET_SELECT =
  "*, asset_categories(code,name), locations(code,name,warehouses(code,name)), departments(code,name)";

interface MovementRow extends AssetMovement {
  from_location_name?: string | null;
  to_location_name?: string | null;
  mover_name?: string | null;
}

type ConfirmKind = "archive" | "publish" | null;

const STATUS_VARIANT: Record<AssetStatus, "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info"> = {
  tersedia: "success",
  digunakan: "info",
  dipinjamkan: "warning",
  perbaikan: "warning",
  rusak: "destructive",
  dipensiunkan: "secondary",
};

export function AssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, isSuperAdmin, hasPermission } = useAuth();

  const [asset, setAsset] = useState<Asset | null>(null);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmKind, setConfirmKind] = useState<ConfirmKind>(null);
  const [saving, setSaving] = useState(false);

  const canUpdate = hasPermission("assets.update");
  const canArchive = hasPermission("assets.archive");
  // Catatan: izin "assets.publish" ditegakkan di backend khusus untuk super admin
  // (RLS/policy). Di UI, tombol hanya tampil bila user super admin ATAU punya izin tsb.
  const canPublish = isSuperAdmin || hasPermission("assets.publish");

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      const { data, error } = await supabase
        .from("assets")
        .select(ASSET_SELECT)
        .eq("id", id)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        toast.error("Aset tidak ditemukan", {
          description: error?.message ?? "Periksa kembali kode aset.",
        });
        navigate("/aset", { replace: true });
        return;
      }
      const a = data as Asset;
      setAsset(a);

      const { data: movs } = await supabase
        .from("asset_movements")
        .select("*")
        .eq("asset_id", a.id)
        .order("created_at", { ascending: false });
      if (cancelled) return;

      const rows: MovementRow[] = (movs ?? []) as MovementRow[];
      const locIds = new Set<string>();
      const userIds = new Set<string>();
      for (const m of rows) {
        if (m.from_location_id) locIds.add(m.from_location_id);
        if (m.to_location_id) locIds.add(m.to_location_id);
        if (m.moved_by) userIds.add(m.moved_by);
      }
      const locMap = new Map<string, string>();
      const userMap = new Map<string, string>();
      if (locIds.size > 0) {
        const { data: locs } = await supabase
          .from("locations")
          .select("id, name")
          .in("id", [...locIds]);
        for (const l of (locs ?? []) as { id: string; name: string }[]) {
          locMap.set(l.id, l.name);
        }
      }
      if (userIds.size > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", [...userIds]);
        for (const p of (profs ?? []) as { id: string; full_name: string | null; email: string }[]) {
          userMap.set(p.id, p.full_name ?? p.email);
        }
      }
      if (!cancelled) {
        setMovements(
          rows.map((m) => ({
            ...m,
            from_location_name: m.from_location_id ? locMap.get(m.from_location_id) ?? "—" : null,
            to_location_name: m.to_location_id ? locMap.get(m.to_location_id) ?? "—" : null,
            mover_name: m.moved_by ? userMap.get(m.moved_by) ?? "—" : null,
          }))
        );
      }
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id, navigate]);

  const statusLabel = (s: string | null): string =>
    s && s in ASSET_STATUS_LABELS
      ? ASSET_STATUS_LABELS[s as AssetStatus]
      : (s ?? "—");

  const detailRows = useMemo(() => {
    if (!asset) return [];
    const loc = asset.locations;
    const wh = loc?.warehouses?.name ?? loc?.warehouses?.code;
    return [
      { label: "Kode Aset", value: asset.asset_code },
      { label: "Kode Publik", value: asset.public_code },
      { label: "Nama", value: asset.name },
      { label: "Kategori", value: asset.asset_categories?.name ?? "—" },
      { label: "Merek", value: asset.brand ?? "—" },
      { label: "Model", value: asset.model ?? "—" },
      // Kolom privat — staff boleh melihatnya di halaman detail ini.
      { label: "Nomor Seri", value: asset.serial_number ?? "—" },
      { label: "Tanggal Beli", value: formatDate(asset.purchase_date) },
      { label: "Harga Beli", value: formatRupiah(asset.purchase_price) },
      { label: "Lokasi", value: loc ? (wh ? `${wh} — ${loc.name}` : loc.name) : "—" },
      { label: "Departemen", value: asset.departments?.name ?? "—" },
      { label: "Penanggung Jawab", value: asset.custodian ?? "—" },
      { label: "Kondisi", value: ASSET_CONDITION_LABELS[asset.condition] },
      { label: "Status", value: ASSET_STATUS_LABELS[asset.status] },
      {
        label: "Status Arsip",
        value: asset.archived ? "Diarsipkan" : "Aktif",
      },
      {
        label: "Dipublikasikan",
        value: asset.is_published
          ? `Ya${asset.published_at ? ` · ${formatDateTime(asset.published_at)}` : ""}`
          : "Tidak",
      },
      { label: "Dibuat", value: formatDateTime(asset.created_at) },
      { label: "Diubah", value: formatDateTime(asset.updated_at) },
    ];
  }, [asset]);

  const handleArchiveToggle = async () => {
    if (!asset || !id) return;
    setSaving(true);
    const { error } = await supabase
      .from("assets")
      .update({ archived: !asset.archived })
      .eq("id", id);
    setSaving(false);
    if (error) {
      toast.error("Gagal mengubah status arsip", { description: error.message });
      return;
    }
    setAsset({ ...asset, archived: !asset.archived });
    toast.success(asset.archived ? "Aset diaktifkan kembali" : "Aset diarsipkan");
    setConfirmKind(null);
  };

  const handlePublishToggle = async () => {
    if (!asset || !id) return;
    setSaving(true);
    const publishing = !asset.is_published;
    const { error } = await supabase
      .from("assets")
      .update({
        is_published: publishing,
        published_at: publishing ? new Date().toISOString() : null,
        published_by: publishing ? (user?.id ?? null) : null,
      })
      .eq("id", id);
    setSaving(false);
    if (error) {
      toast.error("Gagal mengubah status publikasi", { description: error.message });
      return;
    }
    setAsset({
      ...asset,
      is_published: publishing,
      published_at: publishing ? new Date().toISOString() : null,
      published_by: publishing ? (user?.id ?? null) : null,
    });
    toast.success(publishing ? "Aset dipublikasikan" : "Publikasi dibatalkan");
    setConfirmKind(null);
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!asset) return null;

  const confirmIsArchive = confirmKind === "archive";

  return (
    <div>
      <PageHeader
        title={asset.name}
        description={`Kode: ${asset.asset_code} · Kode publik: ${asset.public_code}`}
        actions={
          <>
            <Button variant="outline" onClick={() => navigate("/aset")}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Kembali
            </Button>
            <Button variant="outline" onClick={() => navigate(`/label?asset=${asset.id}`)}>
              <Printer className="mr-2 h-4 w-4" /> Cetak Label
            </Button>
            {canUpdate && (
              <Button onClick={() => navigate(`/aset/${asset.id}/ubah`)}>
                <Pencil className="mr-2 h-4 w-4" /> Ubah
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Informasi Aset</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
              {detailRows.map((r) => (
                <div key={r.label} className="flex flex-col">
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    {r.label}
                  </dt>
                  <dd className="mt-0.5 text-sm font-medium text-slate-900">{r.value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-6 flex flex-wrap gap-2">
              <Badge variant={STATUS_VARIANT[asset.status]}>
                {ASSET_STATUS_LABELS[asset.status]}
              </Badge>
              <Badge variant="outline">{ASSET_CONDITION_LABELS[asset.condition]}</Badge>
              {asset.is_published ? (
                <Badge variant="success">Publik</Badge>
              ) : (
                <Badge variant="secondary">Privat</Badge>
              )}
              {asset.archived && <Badge variant="destructive">Diarsipkan</Badge>}
            </div>
            {(canArchive || canPublish) && (
              <div className="mt-6 flex flex-wrap gap-2 border-t pt-4">
                {canArchive && (
                  <Button
                    variant="outline"
                    onClick={() => setConfirmKind("archive")}
                  >
                    {asset.archived ? (
                      <>
                        <ArchiveRestore className="mr-2 h-4 w-4" /> Aktifkan
                      </>
                    ) : (
                      <>
                        <Archive className="mr-2 h-4 w-4" /> Arsipkan
                      </>
                    )}
                  </Button>
                )}
                {canPublish && (
                  <Button
                    variant="outline"
                    onClick={() => setConfirmKind("publish")}
                  >
                    {asset.is_published ? (
                      <>
                        <Globe2 className="mr-2 h-4 w-4" /> Batalkan Publikasi
                      </>
                    ) : (
                      <>
                        <Globe className="mr-2 h-4 w-4" /> Publikasikan
                      </>
                    )}
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>QR Code Publik</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-3">
              {asset.photo_url ? (
                <img
                  src={asset.photo_url}
                  alt={asset.name}
                  className="h-32 w-full rounded-lg border object-cover"
                />
              ) : null}
              <QrLabel
                value={publicAssetUrl(asset.public_code)}
                size={160}
                fileName={asset.asset_code}
              />
              <p className="break-all text-center text-xs text-slate-500">
                {publicAssetUrl(asset.public_code)}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Riwayat Perpindahan</CardTitle>
        </CardHeader>
        <CardContent>
          {movements.length === 0 ? (
            <EmptyState
              title="Belum ada riwayat"
              description="Aset ini belum pernah dipindahkan."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Waktu</TableHead>
                  <TableHead>Dari Lokasi</TableHead>
                  <TableHead>Ke Lokasi</TableHead>
                  <TableHead>Dari Status</TableHead>
                  <TableHead>Ke Status</TableHead>
                  <TableHead>Oleh</TableHead>
                  <TableHead>Catatan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(m.created_at)}
                    </TableCell>
                    <TableCell>{m.from_location_name ?? "—"}</TableCell>
                    <TableCell>{m.to_location_name ?? "—"}</TableCell>
                    <TableCell>{statusLabel(m.from_status)}</TableCell>
                    <TableCell>{statusLabel(m.to_status)}</TableCell>
                    <TableCell>{m.mover_name ?? "—"}</TableCell>
                    <TableCell>{m.notes ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmKind !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmKind(null);
        }}
        title={
          confirmIsArchive
            ? asset.archived
              ? "Aktifkan aset ini?"
              : "Arsipkan aset ini?"
            : asset.is_published
              ? "Batalkan publikasi aset ini?"
              : "Publikasikan aset ini?"
        }
        description={
          confirmIsArchive
            ? asset.archived
              ? `Aset ${asset.asset_code} akan muncul kembali di daftar aset aktif.`
              : `Aset ${asset.asset_code} akan disembunyikan dari daftar aset aktif.`
            : asset.is_published
              ? `Halaman publik ${asset.public_code} tidak lagi dapat diakses.`
              : `Halaman publik ${asset.public_code} akan dapat diakses siapa pun yang memindai QR code.`
        }
        confirmLabel={confirmIsArchive ? (asset.archived ? "Aktifkan" : "Arsipkan") : asset.is_published ? "Batalkan Publikasi" : "Publikasikan"}
        destructive={confirmIsArchive ? !asset.archived : asset.is_published}
        loading={saving}
        onConfirm={confirmIsArchive ? handleArchiveToggle : handlePublishToggle}
      />
    </div>
  );
}
