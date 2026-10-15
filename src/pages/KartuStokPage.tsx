import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Select } from "../components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import {
  EXCEL_STATUS_ASET,
  type ExcelStatusAset,
  type InventoryItem,
  type TransactionItemInput,
} from "../types/database";

interface ItemSearchResult {
  id: string;
  sku: string;
  name: string;
}

interface KartuRow {
  key: string;
  item: InventoryItem | null;
  query: string;
  results: ItemSearchResult[];
  searching: boolean;
  open: boolean;
  statusAset: ExcelStatusAset;
  qtyIn: string;
  qtyOut: string;
  resi: string;
  gerai: string;
  keterangan: string;
}

interface WarehouseOption {
  value: string;
  label: string;
}

interface LocationRow {
  id: string;
  code: string;
  name: string;
  warehouse_id: string;
}

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function newRow(): KartuRow {
  return {
    key: crypto.randomUUID(),
    item: null,
    query: "",
    results: [],
    searching: false,
    open: false,
    statusAset: "ASSET BARU",
    qtyIn: "",
    qtyOut: "",
    resi: "",
    gerai: "",
    keterangan: "",
  };
}

const STATUS_OPTIONS = EXCEL_STATUS_ASET.map((s) => ({ value: s, label: s }));

export function KartuStokPage() {
  const [date, setDate] = useState(todayLocal);
  const [ticket, setTicket] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<KartuRow[]>([newRow()]);
  const [warehouseOptions, setWarehouseOptions] = useState<WarehouseOption[]>([]);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const searchTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("warehouses")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (cancelled) return;
      if (error) {
        toast.error(`Gagal memuat gudang: ${error.message}`);
        return;
      }
      setWarehouseOptions(
        ((data ?? []) as { id: string; name: string }[]).map((w) => ({
          value: w.id,
          label: w.name,
        }))
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!warehouseId) {
        setLocations([]);
        return;
      }
      const { data, error } = await supabase
        .from("locations")
        .select("id, code, name, warehouse_id")
        .eq("warehouse_id", warehouseId)
        .eq("is_active", true)
        .order("name");
      if (cancelled) return;
      if (error) {
        toast.error(`Gagal memuat lokasi: ${error.message}`);
        return;
      }
      setLocations((data ?? []) as LocationRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [warehouseId]);

  useEffect(() => {
    const timers = searchTimers.current;
    return () => {
      for (const t of Object.values(timers)) clearTimeout(t);
    };
  }, []);

  const updateRow = (key: string, patch: Partial<KartuRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const searchItems = async (key: string, q: string) => {
    const pattern = `%${q.replace(/[%_]/g, "")}%`;
    const { data, error } = await supabase
      .from("inventory_items")
      .select("id, sku, name")
      .eq("is_active", true)
      .or(`sku.ilike.${pattern},name.ilike.${pattern}`)
      .order("name")
      .limit(15);
    if (error) {
      updateRow(key, { results: [], searching: false });
      return;
    }
    updateRow(key, { results: (data ?? []) as ItemSearchResult[], searching: false });
  };

  const handleQueryChange = (key: string, q: string) => {
    updateRow(key, { query: q, item: null, open: true, searching: true });
    if (searchTimers.current[key]) clearTimeout(searchTimers.current[key]);
    if (q.trim().length < 2) {
      updateRow(key, { results: [], searching: false, open: false });
      return;
    }
    searchTimers.current[key] = setTimeout(() => searchItems(key, q.trim()), 300);
  };

  const pickItem = (key: string, item: ItemSearchResult) => {
    updateRow(key, {
      item: { ...item } as InventoryItem,
      query: `${item.sku} — ${item.name}`,
      results: [],
      searching: false,
      open: false,
    });
  };

  const addRow = () => setRows((prev) => [...prev, newRow()]);
  const removeRow = (key: string) => {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
  };

  /** Lokasi untuk baris: ASSET BARU -> *-BARU, UNREADY -> *-UNREADY, selain itu -> *-RETUR. */
  const locationFor = (statusAset: ExcelStatusAset): LocationRow | null => {
    if (locations.length === 0) return null;
    const upper = statusAset.toUpperCase();
    const suffix = upper.includes("UNREADY")
      ? "-UNREADY"
      : upper.includes("RETUR")
        ? "-RETUR"
        : "-BARU";
    return locations.find((l) => l.code.toUpperCase().endsWith(suffix)) ?? locations[0];
  };

  const validate = (): string | null => {
    if (!date) return "Tanggal wajib diisi.";
    if (!warehouseId) return "Gudang wajib dipilih.";
    const filled = rows.filter((r) => r.item);
    if (filled.length === 0) return "Minimal satu baris barang terisi.";
    for (const r of filled) {
      const qi = Number(r.qtyIn);
      const qo = Number(r.qtyOut);
      const hasIn = Number.isFinite(qi) && qi > 0;
      const hasOut = Number.isFinite(qo) && qo > 0;
      if (!hasIn && !hasOut)
        return `Baris "${r.item!.name}": isi Qty IN atau Qty OUT.`;
      if (hasIn && hasOut)
        return `Baris "${r.item!.name}": isi salah satu saja, IN atau OUT.`;
    }
    return null;
  };

  const postGroup = async (
    type: "in" | "out",
    locId: string,
    items: TransactionItemInput[],
    idemKey: string
  ): Promise<string> => {
    const { data, error } = await supabase.rpc("post_inventory_transaction", {
      p_idempotency_key: idemKey,
      p_type: type,
      p_transaction_date: date,
      p_source_location_id: type === "out" ? locId : null,
      p_dest_location_id: type === "in" ? locId : null,
      p_reference: ticket.trim() || null,
      p_notes: notes.trim() || `Input kartu stok${ticket.trim() ? ` tiket ${ticket.trim()}` : ""}`,
      p_items: items,
    });
    if (error) throw new Error(error.message);
    return String(data ?? "");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return;
    }
    setSubmitting(true);
    try {
      // Kelompokkan per (arah, lokasi).
      const groups = new Map<string, { type: "in" | "out"; locId: string; items: TransactionItemInput[] }>();
      for (const r of rows) {
        if (!r.item) continue;
        const qi = Number(r.qtyIn);
        const qo = Number(r.qtyOut);
        const isIn = Number.isFinite(qi) && qi > 0;
        const loc = locationFor(r.statusAset);
        if (!loc) {
          toast.error(`Lokasi untuk status "${r.statusAset}" tidak ditemukan di gudang ini.`);
          return;
        }
        const key = `${isIn ? "in" : "out"}|${loc.id}`;
        let g = groups.get(key);
        if (!g) {
          g = { type: isIn ? "in" : "out", locId: loc.id, items: [] };
          groups.set(key, g);
        }
        const existing = g.items.find((i) => i.item_id === r.item!.id);
        const line: TransactionItemInput = {
          item_id: r.item!.id,
          qty: isIn ? qi : qo,
          resi: r.resi.trim() || null,
          gerai: r.gerai.trim() || null,
          status_aset: r.statusAset,
          notes: r.keterangan.trim() || null,
        };
        if (existing) {
          // Gabung baris ganda item yang sama: jumlahkan qty, gabung resi.
          existing.qty += line.qty;
          if (line.resi) existing.resi = [existing.resi, line.resi].filter(Boolean).join("\n");
          if (line.notes) existing.notes = [existing.notes, line.notes].filter(Boolean).join("; ");
        } else {
          g.items.push(line);
        }
      }

      const docs: string[] = [];
      for (const g of groups.values()) {
        const doc = await postGroup(g.type, g.locId, g.items, crypto.randomUUID());
        docs.push(doc);
      }
      toast.success(`Kartu stok tersimpan: ${docs.join(", ")}`);
      setTicket("");
      setNotes("");
      setRows([newRow()]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan kartu stok.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Input Kartu Stok"
        description="Catat pergerakan harian ala Excel KARTU STOK: tiket, IN/OUT, resi, gerai, status aset."
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" /> Form Kartu Stok
          </CardTitle>
          <CardDescription>
            Satu tiket bisa berisi baris IN dan OUT sekaligus — sistem otomatis
            memisahnya menjadi transaksi masuk & keluar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="ks-date">Tanggal</Label>
                <Input
                  id="ks-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ks-ticket">No. Tiket</Label>
                <Input
                  id="ks-ticket"
                  value={ticket}
                  onChange={(e) => setTicket(e.target.value)}
                  placeholder="cth: A2609281981"
                  maxLength={50}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ks-warehouse">Gudang</Label>
                <Select
                  id="ks-warehouse"
                  options={warehouseOptions}
                  placeholder="Pilih gudang"
                  value={warehouseId}
                  onValueChange={setWarehouseId}
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Baris Kartu Stok</Label>
                <Button type="button" variant="outline" size="sm" onClick={addRow}>
                  <Plus className="mr-1 h-4 w-4" /> Tambah Baris
                </Button>
              </div>

              {rows.map((row, idx) => (
                <div
                  key={row.key}
                  className="space-y-2 rounded-lg border border-slate-200 p-3"
                >
                  <div className="grid gap-2 md:grid-cols-[1fr_170px_90px_90px_40px]">
                    <div className="relative">
                      <Input
                        placeholder="Ketik SKU / nama barang…"
                        value={row.query}
                        onChange={(e) => handleQueryChange(row.key, e.target.value)}
                        onBlur={() => setTimeout(() => updateRow(row.key, { open: false }), 150)}
                        onFocus={() => row.results.length > 0 && updateRow(row.key, { open: true })}
                        aria-label={`Barang baris ${idx + 1}`}
                      />
                      {row.open && (
                        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                          {row.searching ? (
                            <div className="px-3 py-2 text-sm text-slate-500">Mencari…</div>
                          ) : row.results.length === 0 ? (
                            <div className="px-3 py-2 text-sm text-slate-500">
                              Tidak ada barang yang cocok.
                            </div>
                          ) : (
                            row.results.map((r) => (
                              <button
                                key={r.id}
                                type="button"
                                className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  pickItem(row.key, r);
                                }}
                              >
                                <span className="font-medium">{r.sku}</span>
                                <span className="text-slate-500"> — {r.name}</span>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                    <Select
                      options={STATUS_OPTIONS}
                      value={row.statusAset}
                      onValueChange={(v) =>
                        updateRow(row.key, { statusAset: v as ExcelStatusAset })
                      }
                      aria-label={`Status aset baris ${idx + 1}`}
                    />
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      placeholder="IN"
                      aria-label={`Qty IN baris ${idx + 1}`}
                      value={row.qtyIn}
                      onChange={(e) => updateRow(row.key, { qtyIn: e.target.value })}
                    />
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      placeholder="OUT"
                      aria-label={`Qty OUT baris ${idx + 1}`}
                      value={row.qtyOut}
                      onChange={(e) => updateRow(row.key, { qtyOut: e.target.value })}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={rows.length === 1}
                      onClick={() => removeRow(row.key)}
                      aria-label={`Hapus baris ${idx + 1}`}
                    >
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  </div>
                  <div className="grid gap-2 md:grid-cols-3">
                    <Input
                      placeholder="No. resi (boleh beberapa, pisahkan baris baru)"
                      aria-label={`Resi baris ${idx + 1}`}
                      value={row.resi}
                      onChange={(e) => updateRow(row.key, { resi: e.target.value })}
                    />
                    <Input
                      placeholder="Nama gerai tujuan/asal"
                      aria-label={`Gerai baris ${idx + 1}`}
                      value={row.gerai}
                      onChange={(e) => updateRow(row.key, { gerai: e.target.value })}
                    />
                    <Input
                      placeholder="Keterangan"
                      aria-label={`Keterangan baris ${idx + 1}`}
                      value={row.keterangan}
                      onChange={(e) => updateRow(row.key, { keterangan: e.target.value })}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ks-notes">Catatan tiket (opsional)</Label>
              <Textarea
                id="ks-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Catatan untuk seluruh tiket…"
                maxLength={500}
                rows={2}
              />
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={submitting}>
                {submitting ? "Menyimpan…" : "Simpan Kartu Stok"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
