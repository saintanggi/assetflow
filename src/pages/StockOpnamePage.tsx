import { useEffect, useMemo, useState } from "react";
import type { HTMLAttributes } from "react";
import { ScanLine, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { badgeDarkClass } from "../lib/statusColors";
import { cn } from "../lib/utils";
import { formatDate, formatQty } from "../lib/format";
import { PageHeader } from "../components/PageHeader";
import { BarcodeScanner } from "../components/BarcodeScanner";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select } from "../components/ui/select";
import { Badge } from "../components/ui/badge";
import {
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
  barcode: string | null;
  name: string;
  systemQty: number;
  countedQty: string;
}

/** Permukaan kaca gelap — sama seperti dashboard & Stok Kondisi. */
function GlassCard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/15 bg-white/[0.07] shadow-[0_8px_32px_rgba(2,6,23,0.35)] backdrop-blur-xl transition-all duration-300 hover:border-white/25 hover:bg-white/[0.09]",
        className
      )}
      {...props}
    />
  );
}

function generateOpnameDocNumber(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `OPN-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
    d.getHours()
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

const OPNAME_DRAFT_STORAGE_PREFIX = "assetflow:opname-draft:";

export function StockOpnamePage() {
  const [locationOptions, setLocationOptions] = useState<LocationOption[]>([]);
  const [locationId, setLocationId] = useState("");
  const [lines, setLines] = useState<OpnameLine[]>([]);
  const [lineFilter, setLineFilter] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const [scanInput, setScanInput] = useState("");
  const [lastScannedId, setLastScannedId] = useState<string | null>(null);
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
      // Ambil semua barang aktif secara bertahap (aman di atas batas 1.000 baris PostgREST).
      const allItems: { id: string; sku: string; barcode: string | null; name: string }[] = [];
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const { data: chunk, error: itemsError } = await supabase
          .from("inventory_items")
          .select("id, sku, barcode, name")
          .eq("is_active", true)
          .order("name")
          .range(from, from + pageSize - 1);
        if (itemsError) {
          toast.error(`Gagal memuat barang: ${itemsError.message}`);
          return;
        }
        const rows = (chunk ?? []) as { id: string; sku: string; barcode: string | null; name: string }[];
        allItems.push(...rows);
        if (rows.length < pageSize) break;
      }

      const balances = new Map<string, number>();
      for (let from = 0; ; from += pageSize) {
        const { data: bChunk, error: balancesError } = await supabase
          .from("inventory_balances")
          .select("item_id, qty")
          .eq("location_id", locationId)
          .range(from, from + pageSize - 1);
        if (balancesError) {
          toast.error(`Gagal memuat saldo: ${balancesError.message}`);
          return;
        }
        const bRows = (bChunk ?? []) as { item_id: string; qty: number }[];
        for (const b of bRows) balances.set(b.item_id, Number(b.qty));
        if (bRows.length < pageSize) break;
      }

      // Pulihkan draft hitungan lokal bila user sempat refresh browser.
      let savedDraft: Record<string, string> = {};
      try {
        const raw = localStorage.getItem(`${OPNAME_DRAFT_STORAGE_PREFIX}${locationId}`);
        if (raw) savedDraft = JSON.parse(raw) as Record<string, string>;
      } catch {
        savedDraft = {};
      }
      const restoredCount = Object.values(savedDraft).filter((v) => v.trim() !== "").length;
      if (restoredCount > 0) {
        toast.info(`Draft lokal dipulihkan (${restoredCount} barang terisi).`);
      }

      setLineFilter("");
      setLastScannedId(null);
      setLines(
        allItems.map((it) => ({
          itemId: it.id,
          sku: it.sku,
          barcode: it.barcode,
          name: it.name,
          systemQty: balances.get(it.id) ?? 0,
          countedQty: savedDraft[it.id] ?? "",
        }))
      );
    } finally {
      setLoadingLines(false);
    }
  };

  const setCountedQty = (itemId: string, value: string) => {
    setLines((prev) => {
      const next = prev.map((l) => (l.itemId === itemId ? { ...l, countedQty: value } : l));
      if (locationId) {
        try {
          const map: Record<string, string> = {};
          for (const l of next) {
            if (l.countedQty.trim() !== "") map[l.itemId] = l.countedQty;
          }
          localStorage.setItem(`${OPNAME_DRAFT_STORAGE_PREFIX}${locationId}`, JSON.stringify(map));
        } catch {
          // Abaikan bila quota localStorage penuh.
        }
      }
      return next;
    });
  };

  const handleOpnameScan = (rawCode: string) => {
    const code = rawCode.trim().toUpperCase();
    if (!code) return;
    const match = lines.find(
      (l) =>
        l.sku.trim().toUpperCase() === code ||
        (l.barcode ?? "").trim().toUpperCase() === code
    );
    if (!match) {
      toast.error(`Barcode/SKU "${rawCode.trim()}" tidak ditemukan di daftar opname.`);
      return;
    }
    const cur = match.countedQty.trim() === "" ? 0 : Number(match.countedQty);
    const next = (Number.isFinite(cur) ? cur : 0) + 1;
    setCountedQty(match.itemId, String(next));
    setLastScannedId(match.itemId);
    toast.success(`+1 ${match.name} → Hitung: ${formatQty(next)}`);
  };

  const filteredLines = useMemo(() => {
    const q = lineFilter.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter(
      (l) => l.name.toLowerCase().includes(q) || l.sku.toLowerCase().includes(q)
    );
  }, [lines, lineFilter]);

  const filledCount = useMemo(
    () => lines.filter((l) => l.countedQty.trim() !== "").length,
    [lines]
  );

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
      try {
        localStorage.removeItem(`${OPNAME_DRAFT_STORAGE_PREFIX}${locationId}`);
      } catch {
        // ignore
      }
      setLines([]);
      setLineFilter("");
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

  const varianceStats = (c: StockCount) => {
    const items = c.stock_count_items ?? [];
    let net = 0;
    let absTotal = 0;
    let changedItems = 0;
    for (const it of items) {
      const d = Number(it.counted_qty) - Number(it.system_qty);
      net += d;
      if (d !== 0) {
        absTotal += Math.abs(d);
        changedItems += 1;
      }
    }
    return { net, absTotal, changedItems };
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock Opname"
        description="Hitung fisik barang lalu finalisasi untuk membuat transaksi penyesuaian"
      />

      <GlassCard>
        <CardHeader>
          <CardTitle className="text-white">Langkah 1 — Input Hasil Hitung</CardTitle>
          <CardDescription className="text-ink-300">
            Pilih lokasi, muat barang, lalu isi hasil perhitungan fisik setiap
            barang.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="w-full space-y-1.5 sm:max-w-sm">
              <Label className="text-white" htmlFor="opname-location">Lokasi</Label>
              <Select className="border-white/15 bg-white/10 text-white [color-scheme:dark]"
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
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative w-full sm:w-56">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-300" />
                    <Input
                      className="border-white/15 bg-white/10 pl-9 text-white placeholder:text-ink-300"
                      placeholder="Filter SKU / nama barang…"
                      value={lineFilter}
                      onChange={(e) => setLineFilter(e.target.value)}
                    />
                  </div>
                  <Input
                    className="w-52 border-white/15 bg-white/10 text-white placeholder:text-ink-300"
                    placeholder="Scan barcode / SKU (+1)…"
                    value={scanInput}
                    onChange={(e) => setScanInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleOpnameScan(scanInput);
                        setScanInput("");
                      }
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-white/20 bg-white/10 text-white hover:bg-white/15 hover:text-white"
                    onClick={() => setScanOpen(true)}
                  >
                    <ScanLine className="mr-1.5 h-4 w-4" /> Pindai (+1)
                  </Button>
                </div>
                <div className="flex items-center gap-3 text-xs text-ink-200">
                  <span>
                    Terisi:{" "}
                    <b className="text-white">
                      {filledCount} / {lines.length}
                    </b>{" "}
                    barang
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-white/20 bg-white/10 text-white hover:bg-white/15 hover:text-white"
                    onClick={() => {
                      setLines((prev) =>
                        prev.map((l) =>
                          l.countedQty.trim() === "" ? { ...l, countedQty: String(l.systemQty) } : l
                        )
                      );
                    }}
                  >
                    Isi Kosong = Sistem
                  </Button>
                </div>
              </div>
              <Table dark>
                <TableHeader dark>
                  <TableRow dark>
                    <TableHead dark>SKU</TableHead>
                    <TableHead dark>Nama Barang</TableHead>
                    <TableHead dark className="text-right">Stok Sistem</TableHead>
                    <TableHead dark className="w-40">Hasil Hitung</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLines.map((l) => (
                    <TableRow
                      dark
                      key={l.itemId}
                      className={lastScannedId === l.itemId ? "bg-ok-500/15" : undefined}
                    >
                      <TableCell className="font-medium">{l.sku}</TableCell>
                      <TableCell>{l.name}</TableCell>
                      <TableCell className="text-right">{formatQty(l.systemQty)}</TableCell>
                      <TableCell>
                        <Input className="border-white/15 bg-white/10 text-white placeholder:text-ink-300"
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
      </GlassCard>

      <GlassCard>
        <CardHeader>
          <CardTitle className="text-white">Langkah 2 — Daftar Opname & Finalisasi</CardTitle>
          <CardDescription className="text-ink-300">
            Finalisasi draft opname akan memposting selisih sebagai transaksi
            penyesuaian stok.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingCounts ? (
            <p className="text-sm text-ink-300">Memuat daftar opname…</p>
          ) : counts.length === 0 ? (
            <p className="text-sm text-ink-300">Belum ada draft opname.</p>
          ) : (
            <Table dark>
              <TableHeader dark>
                <TableRow dark>
                  <TableHead dark>No. Dokumen</TableHead>
                  <TableHead dark>Tanggal</TableHead>
                  <TableHead dark>Lokasi</TableHead>
                  <TableHead dark className="text-right">Selisih</TableHead>
                  <TableHead dark>Status</TableHead>
                  <TableHead dark className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {counts.map((c) => {
                  const v = varianceStats(c);
                  return (
                    <TableRow dark key={c.id}>
                      <TableCell className="font-medium">{c.doc_number}</TableCell>
                      <TableCell>{formatDate(c.created_at)}</TableCell>
                      <TableCell>{locationLabel(c.location_id)}</TableCell>
                      <TableCell
                        className={`text-right font-medium ${
                          v.changedItems > 0 ? "text-warn-200" : "text-ink-300"
                        }`}
                      >
                        {v.changedItems === 0 ? (
                          "0 (Cocok)"
                        ) : (
                          <span>
                            {v.net > 0 ? "+" : ""}
                            {formatQty(v.net)}{" "}
                            <span className="text-xs text-ink-300">
                              ({v.changedItems} item, total ±{formatQty(v.absTotal)})
                            </span>
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={c.status === "posted" ? "success" : "warning"} className={badgeDarkClass[c.status === "posted" ? "success" : "warning"]}>
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
      </GlassCard>

      <ConfirmDialog
        open={finalizeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setFinalizeTarget(null);
        }}
        title="Finalisasi Stock Opname"
        description={
          finalizeTarget
            ? (() => {
                const v = varianceStats(finalizeTarget);
                if (v.changedItems === 0) {
                  return `Finalisasi ${finalizeTarget.doc_number}? Semua stok fisik cocok dengan sistem (0 selisih) — tidak ada transaksi penyesuaian yang perlu dibuat.`;
                }
                return `Finalisasi ${finalizeTarget.doc_number}? ${v.changedItems} item memiliki selisih (neto ${v.net > 0 ? "+" : ""}${formatQty(v.net)}, total pergeseran ±${formatQty(v.absTotal)}) yang akan diposting sebagai transaksi penyesuaian.`;
              })()
            : ""
        }
        confirmLabel="Finalisasi"
        loading={finalizing}
        onConfirm={finalize}
      />

      <BarcodeScanner
        open={scanOpen}
        onOpenChange={setScanOpen}
        onScan={(code) => {
          handleOpnameScan(code);
          setScanOpen(false);
        }}
      />
    </div>
  );
}
