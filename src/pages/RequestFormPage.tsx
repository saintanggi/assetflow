import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
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
import { formatQty } from "../lib/format";
import {
  itemStockLines,
  stockForAset,
  stockShortageHint,
  type LocationRow,
  type StockByLocationMap,
} from "../features/requests/shipStock";

interface ItemSearchResult {
  id: string;
  sku: string;
  name: string;
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
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [ticketNo, setTicketNo] = useState("");
  const [branchName, setBranchName] = useState("");
  const [branchCode, setBranchCode] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<FormRow[]>([newRow()]);
  const [submitting, setSubmitting] = useState(false);
  const searchTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Sisa stok per barang & lokasi (Baru/Retur/Unready) agar bisa dilihat
  // sebelum permintaan dikirim.
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [stockByLoc, setStockByLoc] = useState<StockByLocationMap>({});
  const [stockLoaded, setStockLoaded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const timers = searchTimers.current;
    return () => {
      for (const t of Object.values(timers)) clearTimeout(t);
    };
  }, []);

  // Lokasi kategori stok (kode unik) untuk menampilkan sisa stok.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("id, code, name")
        .eq("is_active", true)
        .in("code", ["STOK-BARU", "STOK-RETUR", "STOK-UNREADY"])
        .order("code");
      if (cancelled) return;
      if (error) {
        toast.error(`Gagal memuat lokasi stok: ${error.message}`);
        return;
      }
      setLocations((data ?? []) as LocationRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Muat saldo per lokasi untuk barang-barang yang dipilih/dicari. */
  const loadStock = async (itemIds: string[]) => {
    const ids = [...new Set(itemIds.filter(Boolean))];
    if (ids.length === 0) return;
    const { data, error } = await supabase
      .from("inventory_balances")
      .select("item_id, location_id, qty")
      .in("item_id", ids);
    if (error) {
      toast.error(`Gagal memuat sisa stok: ${error.message}`);
      return;
    }
    const patch: StockByLocationMap = {};
    for (const b of (data ?? []) as {
      item_id: string;
      location_id: string;
      qty: number | string;
    }[]) {
      patch[`${b.item_id}|${b.location_id}`] = Number(b.qty);
    }
    setStockByLoc((prev) => ({ ...prev, ...patch }));
    setStockLoaded((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = true;
      return next;
    });
  };

  const updateRow = (key: string, patch: Partial<FormRow>) => {
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
    const results = (data ?? []) as ItemSearchResult[];
    updateRow(key, { results, searching: false });
    // Prefetch stok agar sisa stok tampil langsung di daftar hasil pencarian.
    void loadStock(results.map((r) => r.id));
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
    if (!stockLoaded[item.id]) void loadStock([item.id]);
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

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-base text-ink-800">Data Permintaan</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label>Tanggal Input</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>No Tiket</Label>
            <Input
              value={ticketNo}
              onChange={(e) => setTicketNo(e.target.value)}
              placeholder="cth: A2609281981"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Cabang / Gerai</Label>
            <Input
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              placeholder="cth: Jakarta Sortation"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Kode Gerai (opsional)</Label>
            <Input
              value={branchCode}
              onChange={(e) => setBranchCode(e.target.value)}
              placeholder="cth: JKT-SRT-01"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
            <Label>Catatan (opsional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Keterangan tambahan untuk admin gudang…"
              rows={2}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="font-display text-base text-ink-800">Daftar Barang</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {rows.map((r, i) => (
            <div
              key={r.key}
              className="grid gap-3 rounded-lg border border-ink-200 bg-ink-50 p-3 lg:grid-cols-[repeat(16,minmax(0,1fr))]"
            >
              <div className="relative lg:col-span-4">
                <Label>Barang #{i + 1}</Label>
                <Input
                  value={r.query}
                  onChange={(e) => handleQueryChange(r.key, e.target.value)}
                  onBlur={() => setTimeout(() => updateRow(r.key, { open: false }), 150)}
                  placeholder="Ketik nama / SKU barang…"
                  autoComplete="off"
                />
                {r.open && r.results.length > 0 && (
                  <div className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-md border border-ink-200 bg-white shadow-xl">
                    {r.results.map((it) => (
                      <button
                        key={it.id}
                        type="button"
                        className="block w-full px-3 py-2 text-left text-sm text-ink-800 hover:bg-ink-100"
                        onMouseDown={() => pickItem(r.key, it)}
                      >
                        <span className="font-mono text-xs text-ink-500">{it.sku}</span> — {it.name}
                        {stockLoaded[it.id] && (
                          <span className="mt-0.5 block text-xs text-ink-500">
                            Sisa stok:{" "}
                            {itemStockLines(it.id, locations, stockByLoc)
                              .map((line) => `${line.label} ${formatQty(line.qty)}`)
                              .join(" · ")}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                {r.item && stockLoaded[r.item.id] && (() => {
                  const target = stockForAset(r.item.id, r.statusAset, locations, stockByLoc);
                  const lines = itemStockLines(r.item.id, locations, stockByLoc);
                  return (
                    <div className="mt-1 text-xs">
                      <span className="text-ink-500">Sisa stok: </span>
                      {lines.map((line, idx) => (
                        <span key={line.code}>
                          {idx > 0 && <span className="text-ink-400"> · </span>}
                          <span
                            className={
                              line.code === target.code
                                ? "font-semibold text-brand-700"
                                : line.qty > 0
                                  ? "text-ink-700"
                                  : "text-ink-400"
                            }
                          >
                            {line.label} {formatQty(line.qty)}
                          </span>
                        </span>
                      ))}
                    </div>
                  );
                })()}
              </div>
              <div className="lg:col-span-1">
                <Label>Qty</Label>
                <Input
                  type="number"
                  min="0"
                  value={r.qty}
                  onChange={(e) => updateRow(r.key, { qty: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div className="lg:col-span-2">
                <Label>Type Barang</Label>
                <Input
                  value={r.itemType}
                  onChange={(e) => updateRow(r.key, { itemType: e.target.value })}
                  placeholder="cth: Elektronik"
                />
              </div>
              <div className="lg:col-span-2">
                <Label htmlFor={`sr-${r.key}`}>Status Request</Label>
                <Select
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
                  <Label htmlFor={`dur-${r.key}`}>Durasi Pinjam</Label>
                  <Input
                    id={`dur-${r.key}`}
                    value={r.durasiPinjam}
                    onChange={(e) => updateRow(r.key, { durasiPinjam: e.target.value })}
                    placeholder="cth: 1 MINGGU"
                  />
                </div>
              )}
              <div className="lg:col-span-2">
                <Label htmlFor={`sa-${r.key}`}>Status Asset</Label>
                <Select
                  id={`sa-${r.key}`}
                  value={r.statusAset}
                  onValueChange={(v) => updateRow(r.key, { statusAset: v as ExcelStatusAset })}
                  options={(Object.keys(EXCEL_STATUS_ASET_LABELS) as ExcelStatusAset[]).map((o) => ({
                    value: o,
                    label: EXCEL_STATUS_ASET_LABELS[o],
                  }))}
                />
                <p className="mt-1 text-xs text-ink-500">
                  Stok dipotong dari <b>{EXCEL_STATUS_ASET_LOKASI[r.statusAset]}</b>
                  {r.item && stockLoaded[r.item.id] && (
                    <span className="block">
                      Sisa di lokasi ini:{" "}
                      <b className="text-brand-700">
                        {formatQty(
                          stockForAset(r.item.id, r.statusAset, locations, stockByLoc).qty
                        )}
                      </b>
                    </span>
                  )}
                </p>
              </div>
              <div className="lg:col-span-2">
                <Label>Serial Number (opsional)</Label>
                <Input
                  value={r.serialNumber}
                  onChange={(e) => updateRow(r.key, { serialNumber: e.target.value })}
                  placeholder="SN…"
                />
              </div>
              <div className="flex items-end lg:col-span-1">
                <Button
                  variant="ghost"
                  size="icon"
                  title="Hapus baris"
                  aria-label="Hapus baris"
                  onClick={() =>
                    setRows((p) => (p.length > 1 ? p.filter((x) => x.key !== r.key) : p))
                  }
                  disabled={rows.length <= 1}
                >
                  <Trash2 className="h-4 w-4 text-brand-600" />
                </Button>
              </div>
              {r.item && stockLoaded[r.item.id] && (() => {
                const target = stockForAset(r.item.id, r.statusAset, locations, stockByLoc);
                const hint = stockShortageHint(Number(r.qty), r.statusAset, target);
                if (!hint) return null;
                return (
                  <div className="rounded-md border border-warn-100 bg-warn-50 px-3 py-2 text-xs font-medium text-warn-700 lg:col-span-16">
                    {hint}
                  </div>
                );
              })()}
              <div className="lg:col-span-16">
                <Label>Keterangan baris (opsional)</Label>
                <Input
                  value={r.notes}
                  onChange={(e) => updateRow(r.key, { notes: e.target.value })}
                  placeholder="cth: untuk penggantian unit rusak…"
                />
              </div>
            </div>
          ))}
          <div className="flex justify-start pt-1">
            <Button variant="outline" size="sm" onClick={() => setRows((p) => [...p, newRow()])}>
              <Plus className="mr-1 h-4 w-4" /> Tambah Baris
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={() => navigate("/permintaan")}>
          Batal
        </Button>
        <Button onClick={handleSubmit} disabled={submitting}>
          {submitting ? "Menyimpan…" : "Kirim Permintaan"}
        </Button>
      </div>
    </div>
  );
}
