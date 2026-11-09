import { useEffect, useRef, useState } from "react";
import type { HTMLAttributes } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { cn } from "../lib/utils";
import { buildSearchPattern } from "../lib/format";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/button";
import { CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Select } from "../components/ui/select";

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

/** Tombol outline di atas kaca gelap (ganti bawaan putih). */
const DARK_OUTLINE_BTN =
  "border-white/20 bg-white/10 text-white hover:border-white/25 hover:bg-white/15 hover:text-white";

const fmtRp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

interface ItemSearchResult {
  id: string;
  sku: string;
  name: string;
  purchase_price: number | null;
}

interface PoLine {
  key: string;
  item: ItemSearchResult | null;
  query: string;
  results: ItemSearchResult[];
  searching: boolean;
  qty: string;
  price: string;
}

const newLine = (): PoLine => ({
  key: crypto.randomUUID(),
  item: null,
  query: "",
  results: [],
  searching: false,
  qty: "1",
  price: "",
});

export function PurchaseOrderFormPage() {
  const navigate = useNavigate();
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<PoLine[]>([newLine()]);
  const [saving, setSaving] = useState(false);
  const searchTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (cancelled) return;
      if (error) {
        toast.error(`Gagal memuat supplier: ${error.message}`);
        return;
      }
      setSuppliers((data ?? []) as { id: string; name: string }[]);
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

  const updateLine = (key: string, patch: Partial<PoLine>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const searchItems = async (key: string, q: string) => {
    const pattern = buildSearchPattern(q);
    const { data, error } = await supabase
      .from("inventory_items")
      .select("id, sku, name, purchase_price")
      .eq("is_active", true)
      .or(`sku.ilike.${pattern},name.ilike.${pattern}`)
      .order("name")
      .limit(15);
    if (error) {
      updateLine(key, { results: [], searching: false });
      return;
    }
    updateLine(key, { results: (data ?? []) as ItemSearchResult[], searching: false });
  };

  const onQueryChange = (key: string, q: string) => {
    updateLine(key, { query: q, item: null, results: [], searching: q.trim().length >= 2 });
    const t = searchTimers.current[key];
    if (t) clearTimeout(t);
    if (q.trim().length < 2) return;
    searchTimers.current[key] = setTimeout(() => searchItems(key, q), 300);
  };

  const pickItem = (key: string, item: ItemSearchResult) => {
    updateLine(key, {
      item,
      query: item.name,
      results: [],
      price: String(item.purchase_price ?? 0),
    });
  };

  const total = lines.reduce(
    (s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0),
    0
  );

  const save = async (status: "draft" | "ordered") => {
    if (!supplierId) {
      toast.error("Pilih supplier dulu.");
      return;
    }
    const valid = lines.filter((l) => l.item && Number(l.qty) > 0);
    if (valid.length === 0) {
      toast.error("Tambahkan minimal 1 barang dengan qty > 0.");
      return;
    }
    const ids = valid.map((l) => l.item!.id);
    if (new Set(ids).size !== ids.length) {
      toast.error("Ada barang yang dobel di PO ini.");
      return;
    }
    setSaving(true);
    try {
      const poNumber = `PO-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
      const { data: po, error: poErr } = await supabase
        .from("purchase_orders")
        .insert({
          po_number: poNumber,
          supplier_id: supplierId,
          status,
          order_date: orderDate,
          expected_date: expectedDate || null,
          total_amount: total,
          notes: notes.trim() || null,
        })
        .select("id")
        .single();
      if (poErr || !po) throw new Error(poErr?.message ?? "Gagal membuat PO");

      const { error: itemsErr } = await supabase.from("purchase_order_items").insert(
        valid.map((l) => ({
          po_id: po.id,
          item_id: l.item!.id,
          qty_ordered: Number(l.qty),
          unit_price: Number(l.price) || 0,
        }))
      );
      if (itemsErr) throw new Error(itemsErr.message);

      toast.success(`PO ${poNumber} berhasil dibuat${status === "ordered" ? " & dipesan" : " (draft)"}`);
      navigate("/pembelian");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan PO");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title="Buat Purchase Order" description="Pesan barang ke supplier — harga otomatis dari harga beli master, bisa diubah." />

      <div className="grid gap-4 lg:grid-cols-3">
        <GlassCard className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-white">Barang yang Dipesan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {lines.map((l, i) => (
              <div key={l.key} className="rounded-lg border border-white/15 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-white">Baris {i + 1}</p>
                  {lines.length > 1 && (
                    <Button variant="ghost" size="sm" className="text-ink-300 hover:bg-white/10 hover:text-white" onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))}>
                      <Trash2 className="h-4 w-4 text-brand-200" />
                    </Button>
                  )}
                </div>
                <div className="relative mt-2">
                  <Input className="border-white/15 bg-white/10 text-white placeholder:text-ink-300"
                    placeholder="Cari barang (nama / SKU)…"
                    value={l.query}
                    onChange={(e) => onQueryChange(l.key, e.target.value)}
                  />
                  {l.results.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-white/15 bg-ink-800 shadow-lg">
                      {l.results.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          className="block w-full px-3 py-2 text-left text-sm text-white hover:bg-white/10"
                          onClick={() => pickItem(l.key, r)}
                        >
                          <span className="font-medium">{r.name}</span>
                          <span className="ml-2 font-mono text-xs text-ink-300">{r.sku}</span>
                          {r.purchase_price !== null && (
                            <span className="float-right text-xs text-ink-300">{fmtRp(Number(r.purchase_price))}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <div>
                    <Label className="text-white">Qty</Label>
                    <Input className="border-white/15 bg-white/10 text-white placeholder:text-ink-300"
                      type="number"
                      min="1"
                      step="1"
                      value={l.qty}
                      onChange={(e) => updateLine(l.key, { qty: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-white">Harga / unit (Rp)</Label>
                    <Input className="border-white/15 bg-white/10 text-white placeholder:text-ink-300"
                      type="number"
                      min="0"
                      step="1000"
                      value={l.price}
                      onChange={(e) => updateLine(l.key, { price: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-white">Subtotal</Label>
                    <Input className="border-white/15 bg-white/10 text-white placeholder:text-ink-300" readOnly value={fmtRp((Number(l.qty) || 0) * (Number(l.price) || 0))} />
                  </div>
                </div>
              </div>
            ))}
            <Button variant="outline" className={DARK_OUTLINE_BTN} onClick={() => setLines((p) => [...p, newLine()])}>
              <Plus className="mr-2 h-4 w-4" /> Tambah Baris
            </Button>
          </CardContent>
        </GlassCard>

        <GlassCard>
          <CardHeader>
            <CardTitle className="text-white">Detail PO</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-white">Supplier *</Label>
              <Select className="border-white/15 bg-white/10 text-white [color-scheme:dark]"
                value={supplierId}
                onValueChange={setSupplierId}
                placeholder="Pilih supplier…"
                options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
              />
              {suppliers.length === 0 && (
                <p className="mt-1 text-xs text-ink-300">
                  Belum ada supplier aktif — tambahkan dulu di menu Master Data → Pemasok.
                </p>
              )}
            </div>
            <div>
              <Label className="text-white">Tanggal Pesan</Label>
              <Input className="border-white/15 bg-white/10 text-white placeholder:text-ink-300 [color-scheme:dark]" type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-white">Estimasi Datang</Label>
              <Input className="border-white/15 bg-white/10 text-white placeholder:text-ink-300 [color-scheme:dark]" type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-white">Catatan</Label>
              <Textarea className="border-white/15 bg-white/10 text-white placeholder:text-ink-300" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Catatan untuk supplier…" />
            </div>
            <div className="rounded-lg bg-white/5 p-3">
              <p className="text-xs text-ink-300">Total PO</p>
              <p className="tnum text-2xl font-bold text-white">{fmtRp(total)}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className={cn("flex-1", DARK_OUTLINE_BTN)} disabled={saving} onClick={() => save("draft")}>
                <X className="mr-1 h-4 w-4" /> Simpan Draft
              </Button>
              <Button className="flex-1" disabled={saving} onClick={() => save("ordered")}>
                {saving ? "Menyimpan…" : "Buat & Pesan"}
              </Button>
            </div>
          </CardContent>
        </GlassCard>
      </div>
    </div>
  );
}
