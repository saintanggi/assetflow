import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { formatDate, formatQty } from "../lib/format";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select } from "../components/ui/select";
import { Badge } from "../components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { ConfirmDialog } from "../components/ConfirmDialog";
import type { StockCount } from "../types/database";

interface LocationOption {
  value: string;
  label: string;
}

interface OpnameLine {
  itemId: string;
  sku: string;
  name: string;
  systemQty: number;
  countedQty: string;
}

function generateOpnameDocNumber(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `OPN-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
    d.getHours()
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function StockOpnamePage() {
  const [locationOptions, setLocationOptions] = useState<LocationOption[]>([]);
  const [locationId, setLocationId] = useState("");
  const [lines, setLines] = useState<OpnameLine[]>([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [saving, setSaving] = useState(false);
  const [counts, setCounts] = useState<StockCount[]>([]);
  const [loadingCounts, setLoadingCounts] = useState(true);
  const [finalizeTarget, setFinalizeTarget] = useState<StockCount | null>(null);
  const [finalizing, setFinalizing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("id, name, warehouses(name)")
        .eq("is_active", true)
        .order("name");
      if (cancelled) return;
      if (error) {
        toast.error(`Gagal memuat lokasi: ${error.message}`);
        return;
      }
      // Hasil query join dinamis (client Supabase tanpa tipe generated).
      const rows = (data ?? []) as {
        id: string;
        name: string;
        warehouses: { name: string }[] | null;
      }[];
      setLocationOptions(
        rows.map((r) => ({
          value: r.id,
          label: r.warehouses?.[0]
            ? `${r.warehouses[0].name} — ${r.name}`
            : r.name,
        }))
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadCounts = async () => {
    setLoadingCounts(true);
    const { data, error } = await supabase
      .from("stock_counts")
      .select(
        "id, doc_number, location_id, status, created_at, stock_count_items(item_id, system_qty, counted_qty)"
      )
      .order("created_at", { ascending: false });
    setLoadingCounts(false);
    if (error) {
      toast.error(`Gagal memuat daftar opname: ${error.message}`);
      return;
    }
    setCounts((data ?? []) as StockCount[]);
  };

  useEffect(() => {
    loadCounts();
  }, []);

  const loadItems = async () => {
    if (!locationId) {
      toast.error("Pilih lokasi terlebih dahulu.");
      return;
    }
    setLoadingLines(true);
    try {
      const { data: itemsData, error: itemsError } = await supabase
        .from("inventory_items")
        .select("id, sku, name")
        .eq("is_active", true)
        .order("name");
      if (itemsError) {
        toast.error(`Gagal memuat barang: ${itemsError.message}`);
        return;
      }
      const { data: balancesData, error: balancesError } = await supabase
        .from("inventory_balances")
        .select("item_id, qty")
        .eq("location_id", locationId);
      if (balancesError) {
        toast.error(`Gagal memuat saldo: ${balancesError.message}`);
        return;
      }
      // Hasil query dinamis (client Supabase tanpa tipe generated).
      const balances = new Map<string, number>();
      for (const b of (balancesData ?? []) as { item_id: string; qty: number }[]) {
        balances.set(b.item_id, Number(b.qty));
      }
      setLines(
        ((itemsData ?? []) as { id: string; sku: string; name: string }[]).map((it) => ({
          itemId: it.id,
          sku: it.sku,
          name: it.name,
          systemQty: balances.get(it.id) ?? 0,
          countedQty: "",
        }))
      );
    } finally {
      setLoadingLines(false);
    }
  };

  const setCountedQty = (itemId: string, value: string) => {
    setLines((prev) =>
      prev.map((l) => (l.itemId === itemId ? { ...l, countedQty: value } : l))
    );
  };

  const saveDraft = async () => {
    if (!locationId) {
      toast.error("Pilih lokasi terlebih dahulu.");
      return;
    }
    if (lines.length === 0) {
      toast.error("Belum ada barang yang dimuat.");
      return;
    }
    for (const l of lines) {
      if (l.countedQty.trim() === "") {
        toast.error(`Hasil hitung untuk "${l.name}" belum diisi.`);
        return;
      }
      const n = Number(l.countedQty);
      if (!Number.isFinite(n) || n < 0) {
        toast.error(`Hasil hitung untuk "${l.name}" tidak valid.`);
        return;
      }
    }
    setSaving(true);
    try {
      const docNumber = generateOpnameDocNumber();
      const { data: countRow, error: countError } = await supabase
        .from("stock_counts")
        .insert({
          doc_number: docNumber,
          location_id: locationId,
          status: "draft",
        })
        .select("id")
        .single();
      if (countError || !countRow) {
        toast.error(`Gagal menyimpan draft: ${countError?.message ?? "unknown"}`);
        return;
      }
      const stockCountId = (countRow as { id: string }).id;
      const { error: itemsError } = await supabase.from("stock_count_items").insert(
        lines.map((l) => ({
          stock_count_id: stockCountId,
          item_id: l.itemId,
          system_qty: l.systemQty,
          counted_qty: Number(l.countedQty),
        }))
      );
      if (itemsError) {
        toast.error(`Gagal menyimpan detail opname: ${itemsError.message}`);
        return;
      }
      toast.success(`Draft opname ${docNumber} tersimpan`);
      setLines([]);
      setLocationId("");
      await loadCounts();
    } finally {
      setSaving(false);
    }
  };

  const finalize = async () => {
    if (!finalizeTarget) return;
    setFinalizing(true);
    try {
      const { error } = await supabase.rpc("finalize_stock_count", {
        p_stock_count_id: finalizeTarget.id,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success(
        `Opname ${finalizeTarget.doc_number} difinalisasi — transaksi penyesuaian dibuat`
      );
      setFinalizeTarget(null);
      await loadCounts();
    } finally {
      setFinalizing(false);
    }
  };

  const locationLabel = (id: string) =>
    locationOptions.find((o) => o.value === id)?.label ?? "—";

  const diffOf = (c: StockCount) =>
    (c.stock_count_items ?? []).reduce(
      (sum, it) => sum + (it.counted_qty - it.system_qty),
      0
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock Opname"
        description="Hitung fisik barang lalu finalisasi untuk membuat transaksi penyesuaian"
      />

      <Card>
        <CardHeader>
          <CardTitle>Langkah 1 — Input Hasil Hitung</CardTitle>
          <CardDescription>
            Pilih lokasi, muat barang, lalu isi hasil perhitungan fisik setiap
            barang.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="w-full space-y-1.5 sm:max-w-sm">
              <Label htmlFor="opname-location">Lokasi</Label>
              <Select
                id="opname-location"
                options={locationOptions}
                placeholder="Pilih lokasi"
                value={locationId}
                onValueChange={setLocationId}
              />
            </div>
            <Button type="button" onClick={loadItems} disabled={loadingLines || !locationId}>
              {loadingLines ? "Memuat…" : "Muat Barang"}
            </Button>
          </div>

          {lines.length > 0 && (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Nama Barang</TableHead>
                    <TableHead className="text-right">Stok Sistem</TableHead>
                    <TableHead className="w-40">Hasil Hitung</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l) => (
                    <TableRow key={l.itemId}>
                      <TableCell className="font-medium">{l.sku}</TableCell>
                      <TableCell>{l.name}</TableCell>
                      <TableCell className="text-right">{formatQty(l.systemQty)}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          placeholder="0"
                          aria-label={`Hasil hitung ${l.name}`}
                          value={l.countedQty}
                          onChange={(e) => setCountedQty(l.itemId, e.target.value)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex justify-end">
                <Button type="button" onClick={saveDraft} disabled={saving}>
                  {saving ? "Menyimpan…" : "Simpan Draft Opname"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Langkah 2 — Daftar Opname & Finalisasi</CardTitle>
          <CardDescription>
            Finalisasi draft opname akan memposting selisih sebagai transaksi
            penyesuaian stok.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingCounts ? (
            <p className="text-sm text-slate-500">Memuat daftar opname…</p>
          ) : counts.length === 0 ? (
            <p className="text-sm text-slate-500">Belum ada draft opname.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No. Dokumen</TableHead>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Lokasi</TableHead>
                  <TableHead className="text-right">Selisih</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {counts.map((c) => {
                  const diff = diffOf(c);
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.doc_number}</TableCell>
                      <TableCell>{formatDate(c.created_at)}</TableCell>
                      <TableCell>{locationLabel(c.location_id)}</TableCell>
                      <TableCell
                        className={`text-right font-medium ${
                          diff > 0
                            ? "text-green-700"
                            : diff < 0
                              ? "text-red-700"
                              : "text-slate-500"
                        }`}
                      >
                        {diff > 0 ? "+" : ""}
                        {formatQty(diff)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={c.status === "posted" ? "success" : "warning"}>
                          {c.status === "posted" ? "Diposting" : "Draft"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {c.status === "draft" && (
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => setFinalizeTarget(c)}
                          >
                            Finalisasi
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={finalizeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setFinalizeTarget(null);
        }}
        title="Finalisasi Stock Opname"
        description={
          finalizeTarget
            ? `Finalisasi ${finalizeTarget.doc_number}? Selisih ${
                diffOf(finalizeTarget) > 0 ? "+" : ""
              }${formatQty(diffOf(finalizeTarget))} akan diposting sebagai transaksi penyesuaian.`
            : ""
        }
        confirmLabel="Finalisasi"
        loading={finalizing}
        onConfirm={finalize}
      />
    </div>
  );
}
