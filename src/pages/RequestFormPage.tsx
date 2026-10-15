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
import { EXCEL_STATUS_ASET, type ExcelStatusAset } from "../types/database";

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
      item,
      query: `${item.sku} — ${item.name}`,
      results: [],
      searching: false,
      open: false,
    });
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
          notes: r.notes.trim() || null,
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
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="font-display text-base text-ink-800">Daftar Barang</CardTitle>
          <Button variant="outline" size="sm" onClick={() => setRows((p) => [...p, newRow()])}>
            <Plus className="mr-1 h-4 w-4" /> Tambah Baris
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {rows.map((r, i) => (
            <div
              key={r.key}
              className="grid gap-3 rounded-lg border border-ink-200 bg-ink-50 p-3 lg:grid-cols-12"
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
                      </button>
                    ))}
                  </div>
                )}
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
                <Label>Status Aset</Label>
                <select
                  value={r.statusAset}
                  onChange={(e) => updateRow(r.key, { statusAset: e.target.value as ExcelStatusAset })}
                  className="w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-800"
                >
                  {EXCEL_STATUS_ASET.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
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
              <div className="lg:col-span-12">
                <Label>Keterangan baris (opsional)</Label>
                <Input
                  value={r.notes}
                  onChange={(e) => updateRow(r.key, { notes: e.target.value })}
                  placeholder="cth: untuk penggantian unit rusak…"
                />
              </div>
            </div>
          ))}
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
