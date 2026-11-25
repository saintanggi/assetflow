import { useEffect, useRef, useState } from "react";
import type { HTMLAttributes } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { cn } from "../lib/utils";
import { buildSearchPattern, todayLocalDate } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Select } from "../components/ui/select";
import {
  EXCEL_STATUS_ASET_LABELS,
  EXCEL_STATUS_ASET_LOKASI,
  STATUS_REQUEST_LABELS,
  STATUS_REQUEST_OPTIONS,
  type ExcelStatusAset,
  type StatusRequest,
} from "../types/database";
import { formatRequestStatus } from "../lib/requestStatus";

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

interface ItemSearchResult {
  id: string;
  sku: string;
  name: string;
}

interface StockByKind {
  baru: number;
  retur: number;
  unready: number;
}

const EMPTY_STOCK: StockByKind = { baru: 0, retur: 0, unready: 0 };

/** Kode lokasi pemotong -> kunci jenis stok. */
function kindOfKode(kode: string): keyof StockByKind {
  if (kode.endsWith("-RETUR")) return "retur";
  if (kode.endsWith("-UNREADY")) return "unready";
  return "baru";
}

interface FormRow {
  key: string;
  query: string;
  item: ItemSearchResult | null;
  results: ItemSearchResult[];
  searching: boolean;
  open: boolean;
  qty: string;
  itemType: string;
  statusAset: ExcelStatusAset;
  statusRequest: StatusRequest;
  /** Diisi hanya bila statusRequest = PINJAM, mis. "1 MINGGU". */
  durasiPinjam: string;
  serialNumber: string;
  notes: string;
}

const newRow = (): FormRow => ({
  key: Math.random().toString(36).slice(2),
  query: "",
  item: null,
  results: [],
  searching: false,
  open: false,
  qty: "",
  itemType: "",
  statusAset: "ASSET BARU",
  statusRequest: "PENAMBAHAN",
  durasiPinjam: "",
  serialNumber: "",
  notes: "",
});

export function RequestFormPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [date, setDate] = useState(() => todayLocalDate());
  const [ticketNo, setTicketNo] = useState("");
  const [branchName, setBranchName] = useState("");
  const [branchCode, setBranchCode] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<FormRow[]>([newRow()]);
  const [submitting, setSubmitting] = useState(false);
  // Sisa stok per barang per jenis (Baru/Retur/Unready) — dipakai sebagai
  // panduan saat memilih barang, supaya tidak mengajukan qty melebihi stok
  // lokasi pemotong (penyebab utama pengiriman gagal).
  const [stock, setStock] = useState<Record<string, StockByKind>>({});
  const [locByCode, setLocByCode] = useState<Record<string, string>>({});
  const searchTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Peta kode lokasi kondisi -> id lokasi (STOK-BARU / STOK-RETUR / STOK-UNREADY).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("locations")
        .select("id, code")
        .in("code", ["STOK-BARU", "STOK-RETUR", "STOK-UNREADY"]);
      if (cancelled) return;
      const m: Record<string, string> = {};
      for (const l of (data ?? []) as { id: string; code: string }[]) m[l.code] = l.id;
      setLocByCode(m);
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

  const updateRow = (key: string, patch: Partial<FormRow>) => {
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
      item,
      query: `${item.sku} — ${item.name}`,
      results: [],
      searching: false,
      open: false,
    });
    // Ambil sisa stok barang ini di tiap lokasi kondisi.
    void (async () => {
      const { data } = await supabase
        .from("inventory_balances")
        .select("location_id, qty")
        .eq("item_id", item.id);
      const byLoc = new Map<string, number>();
      for (const b of (data ?? []) as { location_id: string; qty: number | string }[]) {
        byLoc.set(b.location_id, Number(b.qty) || 0);
      }
      const next: StockByKind = {
        baru: byLoc.get(locByCode["STOK-BARU"] ?? "") ?? 0,
        retur: byLoc.get(locByCode["STOK-RETUR"] ?? "") ?? 0,
        unready: byLoc.get(locByCode["STOK-UNREADY"] ?? "") ?? 0,
      };
      setStock((prev) => ({ ...prev, [item.id]: next }));
    })();
  };

  /** Sisa stok barang pada lokasi pemotong sesuai Status Asset baris. */
  const availableFor = (r: FormRow, s?: StockByKind): number => {
    const kode = EXCEL_STATUS_ASET_LOKASI[r.statusAset];
    return (s ?? EMPTY_STOCK)[kindOfKode(kode)];
  };

  const validate = (): string | null => {
    if (!date) return "Tanggal input wajib diisi.";
    if (!ticketNo.trim()) return "No tiket wajib diisi.";
    if (!branchName.trim()) return "Cabang / gerai wajib diisi.";
    const filled = rows.filter((r) => r.item);
    if (filled.length === 0) return "Minimal satu barang harus dipilih.";
    for (const r of filled) {
      if (!(Number(r.qty) > 0)) return `Qty barang "${r.item!.name}" harus lebih dari 0.`;
    }
    const ids = filled.map((r) => r.item!.id);
    if (new Set(ids).size !== ids.length) return "Ada barang yang dipilih dua kali.";
    return null;
  };

  const handleSubmit = async () => {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    setSubmitting(true);
    try {
      const { data: req, error: reqErr } = await supabase
        .from("requests")
        .insert({
          ticket_no: ticketNo.trim(),
          request_date: date,
          branch_name: branchName.trim(),
          branch_code: branchCode.trim() || null,
          notes: notes.trim() || null,
          requested_by: user?.id ?? null,
        })
        .select("id, request_number")
        .single();
      if (reqErr) throw new Error(reqErr.message);

      const items = rows
        .filter((r) => r.item)
        .map((r) => ({
          request_id: req.id,
          item_id: r.item!.id,
          qty_requested: Number(r.qty),
          item_type: r.itemType.trim() || null,
          status_aset: r.statusAset,
          serial_number: r.serialNumber.trim() || null,
          notes:
            [
              ...(r.notes.trim() ? r.notes.trim().split("\n").map((x) => x.trim()).filter(Boolean) : []),
              `Status request: ${formatRequestStatus({ status: r.statusRequest, durasi: r.durasiPinjam })}`,
            ].join("\n") || null,
        }));
      const { error: itemsErr } = await supabase.from("request_items").insert(items);
      if (itemsErr) throw new Error(itemsErr.message);

      toast.success(`Permintaan ${req.request_number} berhasil dibuat.`);
      navigate(`/permintaan/${req.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan permintaan.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Buat Permintaan Barang"
        description="Input permintaan harian dari kantor pusat untuk diproses gudang."
      />

      <GlassCard>
        <CardHeader>
          <CardTitle className="font-display text-base text-white">Data Permintaan</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-white">Tanggal Input</Label>
            <Input className="border-white/15 bg-white/10 text-white placeholder:text-ink-300 [color-scheme:dark]" type="date" max={todayLocalDate()} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-white">No Tiket</Label>
            <Input className="border-white/15 bg-white/10 text-white placeholder:text-ink-300"
              value={ticketNo}
              onChange={(e) => setTicketNo(e.target.value)}
              placeholder="cth: A2609281981"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-white">Cabang / Gerai</Label>
            <Input className="border-white/15 bg-white/10 text-white placeholder:text-ink-300"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              placeholder="cth: Jakarta Sortation"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-white">Kode Gerai (opsional)</Label>
            <Input className="border-white/15 bg-white/10 text-white placeholder:text-ink-300"
              value={branchCode}
              onChange={(e) => setBranchCode(e.target.value)}
              placeholder="cth: JKT-SRT-01"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
            <Label className="text-white">Catatan (opsional)</Label>
            <Textarea className="border-white/15 bg-white/10 text-white placeholder:text-ink-300"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Keterangan tambahan untuk admin gudang…"
              rows={2}
            />
          </div>
        </CardContent>
      </GlassCard>

      <GlassCard className="mt-4">
        <CardHeader>
          <CardTitle className="font-display text-base text-white">Daftar Barang</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {rows.map((r, i) => (
            <div
              key={r.key}
              className="grid gap-3 rounded-lg border border-white/15 bg-white/5 p-3 lg:grid-cols-[repeat(16,minmax(0,1fr))]"
            >
              <div className="relative lg:col-span-4">
                <Label className="text-white">Barang #{i + 1}</Label>
                <Input className="border-white/15 bg-white/10 text-white placeholder:text-ink-300"
                  value={r.query}
                  onChange={(e) => handleQueryChange(r.key, e.target.value)}
                  onBlur={() => setTimeout(() => updateRow(r.key, { open: false }), 150)}
                  placeholder="Ketik nama / SKU barang…"
                  autoComplete="off"
                />
                {r.item && (() => {
                  const s = stock[r.item.id] ?? EMPTY_STOCK;
                  const kode = EXCEL_STATUS_ASET_LOKASI[r.statusAset];
                  const avail = availableFor(r, s);
                  const qty = Number(r.qty);
                  const over = qty > 0 && qty > avail;
                  return (
                    <div className="mt-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1.5 text-xs">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-ink-300">
                        <span>Sisa stok:</span>
                        <span className="font-medium text-ok-100">{`Baru ${s.baru}`}</span>
                        <span aria-hidden>·</span>
                        <span className="font-medium text-warn-100">{`Retur ${s.retur}`}</span>
                        <span aria-hidden>·</span>
                        <span className="font-medium text-brand-200">{`Unready ${s.unready}`}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-ink-300">
                        <span>Sisa di lokasi ini:</span>
                        <span className={avail > 0 ? "font-semibold text-white" : "font-semibold text-brand-200"}>
                          {avail}
                        </span>
                        <span className="font-mono text-white">{`(${kode})`}</span>
                      </div>
                      {over && (
                        <p className="mt-1 font-medium text-brand-200">
                          {`Qty ${qty} melebihi stok ${kode} (${avail}). Kurangi qty atau minta stok dulu ke gudang.`}
                        </p>
                      )}
                    </div>
                  );
                })()}
                {r.open && r.results.length > 0 && (
                  <div className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-md border border-white/15 bg-ink-800 shadow-xl">
                    {r.results.map((it) => (
                      <button
                        key={it.id}
                        type="button"
                        className="block w-full px-3 py-2 text-left text-sm text-white hover:bg-white/10"
                        onMouseDown={() => pickItem(r.key, it)}
                      >
                        <span className="font-mono text-xs text-ink-300">{it.sku}</span> — {it.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="lg:col-span-1">
                <Label className="text-white">Qty</Label>
                <Input className="border-white/15 bg-white/10 text-white placeholder:text-ink-300"
                  type="number"
                  min="0"
                  value={r.qty}
                  onChange={(e) => updateRow(r.key, { qty: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div className="lg:col-span-2">
                <Label className="text-white">Type Barang</Label>
                <Input className="border-white/15 bg-white/10 text-white placeholder:text-ink-300"
                  value={r.itemType}
                  onChange={(e) => updateRow(r.key, { itemType: e.target.value })}
                  placeholder="cth: Elektronik"
                />
              </div>
              <div className="lg:col-span-2">
                <Label className="text-white" htmlFor={`sr-${r.key}`}>Status Request</Label>
                <Select className="border-white/15 bg-white/10 text-white [color-scheme:dark]"
                  id={`sr-${r.key}`}
                  value={r.statusRequest}
                  onValueChange={(v) => updateRow(r.key, { statusRequest: v as StatusRequest })}
                  options={STATUS_REQUEST_OPTIONS.map((o) => ({
                    value: o,
                    label: STATUS_REQUEST_LABELS[o],
                  }))}
                />
              </div>
              {r.statusRequest === "PINJAM" && (
                <div className="lg:col-span-2">
                  <Label className="text-white" htmlFor={`dur-${r.key}`}>Durasi Pinjam</Label>
                  <Input className="border-white/15 bg-white/10 text-white placeholder:text-ink-300"
                    id={`dur-${r.key}`}
                    value={r.durasiPinjam}
                    onChange={(e) => updateRow(r.key, { durasiPinjam: e.target.value })}
                    placeholder="cth: 1 MINGGU"
                  />
                </div>
              )}
              <div className="lg:col-span-2">
                <Label className="text-white" htmlFor={`sa-${r.key}`}>Status Asset</Label>
                <Select className="border-white/15 bg-white/10 text-white [color-scheme:dark]"
                  id={`sa-${r.key}`}
                  value={r.statusAset}
                  onValueChange={(v) => updateRow(r.key, { statusAset: v as ExcelStatusAset })}
                  options={(Object.keys(EXCEL_STATUS_ASET_LABELS) as ExcelStatusAset[]).map((o) => ({
                    value: o,
                    label: EXCEL_STATUS_ASET_LABELS[o],
                  }))}
                />
                <p className="mt-1 text-xs text-ink-300">
                  Stok dipotong dari <b>{EXCEL_STATUS_ASET_LOKASI[r.statusAset]}</b>
                </p>
              </div>
              <div className="lg:col-span-2">
                <Label className="text-white">Serial Number (opsional)</Label>
                <Input className="border-white/15 bg-white/10 text-white placeholder:text-ink-300"
                  value={r.serialNumber}
                  onChange={(e) => updateRow(r.key, { serialNumber: e.target.value })}
                  placeholder="SN…"
                />
              </div>
              <div className="flex items-end lg:col-span-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-ink-300 hover:bg-white/10 hover:text-white"
                  title="Hapus baris"
                  aria-label="Hapus baris"
                  onClick={() =>
                    setRows((p) => (p.length > 1 ? p.filter((x) => x.key !== r.key) : p))
                  }
                  disabled={rows.length <= 1}
                >
                  <Trash2 className="h-4 w-4 text-brand-200" />
                </Button>
              </div>
              <div className="lg:col-span-16">
                <Label className="text-white">Keterangan baris (opsional)</Label>
                <Input className="border-white/15 bg-white/10 text-white placeholder:text-ink-300"
                  value={r.notes}
                  onChange={(e) => updateRow(r.key, { notes: e.target.value })}
                  placeholder="cth: untuk penggantian unit rusak…"
                />
              </div>
            </div>
          ))}
          <div className="flex justify-start">
            <Button
              variant="outline"
              size="sm"
              className={DARK_OUTLINE_BTN}
              onClick={() => setRows((p) => [...p, newRow()])}
            >
              <Plus className="mr-1 h-4 w-4" /> Tambah Baris
            </Button>
          </div>
        </CardContent>
      </GlassCard>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" className={DARK_OUTLINE_BTN} onClick={() => navigate("/permintaan")}>
          Batal
        </Button>
        <Button onClick={handleSubmit} disabled={submitting}>
          {submitting ? "Menyimpan…" : "Kirim Permintaan"}
        </Button>
      </div>
    </div>
  );
}
