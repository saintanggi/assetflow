import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../../lib/supabase";
import { buildSearchPattern } from "../../lib/format";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { Select } from "../../components/ui/select";
import type { InventoryItem, TransactionItemInput } from "../../types/database";

type TransactionFormType = "in" | "out" | "transfer" | "adjust";

interface TransactionFormProps {
  typeLabel: string;
  type: TransactionFormType;
  needSource: boolean;
  needDest: boolean;
  submitLabel?: string;
}

interface ItemSearchResult {
  id: string;
  sku: string;
  name: string;
}

interface ItemRow {
  key: string;
  item: InventoryItem | null;
  query: string;
  qty: string;
  results: ItemSearchResult[];
  searching: boolean;
  open: boolean;
}

interface LocationOption {
  value: string;
  label: string;
}

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function newRow(): ItemRow {
  return {
    key: crypto.randomUUID(),
    item: null,
    query: "",
    qty: "",
    results: [],
    searching: false,
    open: false,
  };
}

/** Tombol outline di atas kaca gelap (ganti bawaan putih). */
const DARK_OUTLINE_BTN =
  "border-white/20 bg-white/10 text-white hover:border-white/25 hover:bg-white/15 hover:text-white";
const DARK_INPUT =
  "border-white/15 bg-white/10 text-white placeholder:text-ink-300";

export function TransactionForm({
  typeLabel,
  type,
  needSource,
  needDest,
  submitLabel = "Posting Transaksi",
}: TransactionFormProps) {
  const [date, setDate] = useState(todayLocal);
  const [sourceId, setSourceId] = useState("");
  const [destId, setDestId] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<ItemRow[]>([newRow()]);
  const [locationOptions, setLocationOptions] = useState<LocationOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const searchTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

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

  useEffect(() => {
    const timers = searchTimers.current;
    return () => {
      for (const t of Object.values(timers)) clearTimeout(t);
    };
  }, []);

  const updateRow = (key: string, patch: Partial<ItemRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const searchItems = async (key: string, q: string) => {
    const pattern = buildSearchPattern(q);
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
    // Hasil RPC/query dinamis (client Supabase tanpa tipe generated).
    updateRow(key, {
      results: ((data ?? []) as ItemSearchResult[]),
      searching: false,
    });
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

  const resetForm = () => {
    setDate(todayLocal());
    setSourceId("");
    setDestId("");
    setReference("");
    setNotes("");
    setRows([newRow()]);
  };

  const validate = (): string | null => {
    if (rows.length === 0 || !rows.some((r) => r.item && Number(r.qty) > 0)) {
      return "Minimal satu barang dengan qty lebih dari 0.";
    }
    for (const r of rows) {
      if (!r.item) return "Ada baris barang yang belum dipilih.";
      if (!Number.isFinite(Number(r.qty)) || Number(r.qty) <= 0)
        return `Qty untuk "${r.item.name}" harus lebih dari 0.`;
    }
    if (needSource && !sourceId) return "Lokasi asal wajib dipilih.";
    if (needDest && !destId) return "Lokasi tujuan wajib dipilih.";
    if (needSource && needDest && sourceId === destId)
      return "Lokasi asal dan tujuan tidak boleh sama.";
    if (!date) return "Tanggal transaksi wajib diisi.";
    return null;
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
      const items: TransactionItemInput[] = rows
        .filter((r) => r.item && Number(r.qty) > 0)
        .map((r) => ({ item_id: r.item!.id, qty: Number(r.qty) }));
      const { data, error } = await supabase.rpc("post_inventory_transaction", {
        p_idempotency_key: crypto.randomUUID(),
        p_type: type,
        p_transaction_date: date,
        p_source_location_id: needSource ? sourceId : null,
        p_dest_location_id: needDest ? destId : null,
        p_reference: reference.trim() || null,
        p_notes: notes.trim() || null,
        p_items: items,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      // Hasil RPC dinamis (client Supabase tanpa tipe generated).
      const docNumber = String(data ?? "");
      toast.success(`Transaksi ${docNumber} berhasil diposting`);
      resetForm();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="trx-date" className="text-ink-100">Tanggal</Label>
          <Input
            id="trx-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            className={`${DARK_INPUT} [color-scheme:dark]`}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="trx-ref" className="text-ink-100">Referensi (opsional)</Label>
          <Input
            id="trx-ref"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="No. PO / SJ / lainnya"
            maxLength={100}
            className={DARK_INPUT}
          />
        </div>
        {needSource && (
          <div className="space-y-1.5">
            <Label htmlFor="trx-source" className="text-ink-100">Lokasi Asal</Label>
            <Select
              id="trx-source"
              options={locationOptions}
              placeholder="Pilih lokasi asal"
              value={sourceId}
              onValueChange={setSourceId}
              className="border-white/15 bg-white/10 text-white [color-scheme:dark]"
            />
          </div>
        )}
        {needDest && (
          <div className="space-y-1.5">
            <Label htmlFor="trx-dest" className="text-ink-100">Lokasi Tujuan</Label>
            <Select
              id="trx-dest"
              options={locationOptions}
              placeholder="Pilih lokasi tujuan"
              value={destId}
              onValueChange={setDestId}
              className="border-white/15 bg-white/10 text-white [color-scheme:dark]"
            />
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-ink-100">Daftar Barang</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addRow}
            className={DARK_OUTLINE_BTN}
          >
            <Plus className="mr-1 h-4 w-4" /> Tambah Barang
          </Button>
        </div>

        {rows.map((row, idx) => (
          <div
            key={row.key}
            className="grid gap-2 rounded-lg border border-white/15 bg-white/5 p-3 sm:grid-cols-[1fr_140px_44px]"
          >
            <div className="relative">
              <Input
                placeholder="Ketik SKU / nama barang…"
                value={row.query}
                onChange={(e) => handleQueryChange(row.key, e.target.value)}
                onBlur={() => setTimeout(() => updateRow(row.key, { open: false }), 150)}
                onFocus={() => row.results.length > 0 && updateRow(row.key, { open: true })}
                className={DARK_INPUT}
              />
              {row.open && (
                <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-white/15 bg-ink-800/95 text-white shadow-lg backdrop-blur-xl">
                  {row.searching ? (
                    <div className="px-3 py-2 text-sm text-ink-300">Mencari…</div>
                  ) : row.results.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-ink-300">
                      Tidak ada barang yang cocok.
                    </div>
                  ) : (
                    row.results.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-white/10"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          pickItem(row.key, r);
                        }}
                      >
                        <span className="font-medium">{r.sku}</span>
                        <span className="text-ink-300"> — {r.name}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <Input
              type="number"
              min={0}
              step="any"
              placeholder="Qty"
              aria-label={`Qty baris ${idx + 1}`}
              value={row.qty}
              onChange={(e) => updateRow(row.key, { qty: e.target.value })}
              className={DARK_INPUT}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={rows.length === 1}
              onClick={() => removeRow(row.key)}
              aria-label={`Hapus baris ${idx + 1}`}
              className="text-ink-300 hover:bg-white/10 hover:text-white"
            >
              <Trash2 className="h-4 w-4 text-brand-200" />
            </Button>
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="trx-notes" className="text-ink-100">Catatan (opsional)</Label>
        <Textarea
          id="trx-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={`Catatan ${typeLabel.toLowerCase()}…`}
          maxLength={500}
          rows={3}
          className={DARK_INPUT}
        />
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Memposting…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
