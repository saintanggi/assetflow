import { useEffect, useMemo, useRef, useState } from "react";
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
  code: string;
  warehouse: string;
}

/** Jenis stok Barang Masuk/Keluar → status aset + lokasi Gudang Utama
    (tujuan untuk Masuk, asal untuk Keluar). */
const JENIS_STOK_OPTIONS = [
  { value: "baru", label: "Baru" },
  { value: "retur", label: "Retur" },
  { value: "unready", label: "Unready" },
] as const;
const JENIS_STATUS_ASET = {
  baru: "ASSET BARU",
  retur: "ASSET RETUR",
  unready: "UNREADY",
} as const;
const JENIS_SUFFIX = { baru: "BARU", retur: "RETUR", unready: "UNREADY" } as const;

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
  // Barang Masuk & Barang Keluar: jenis stok (Baru/Retur/Unready) + gerai.
  // Masuk: gerai = asal barang; Keluar: gerai = tujuan barang.
  const isMasuk = type === "in";
  const isKeluar = type === "out";
  const usesJenisStok = isMasuk || isKeluar;
  const [jenisStok, setJenisStok] = useState("");
  const [gerai, setGerai] = useState("");
  const [geraiOptions, setGeraiOptions] = useState<string[]>([]);
  const [rows, setRows] = useState<ItemRow[]>([newRow()]);
  const [locationOptions, setLocationOptions] = useState<LocationOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const searchTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("id, code, name, warehouses(name)")
        .eq("is_active", true)
        .order("name");
      if (cancelled) return;
      if (error) {
        toast.error(`Gagal memuat lokasi: ${error.message}`);
        return;
      }
      // Hasil query join dinamis (client Supabase tanpa tipe generated).
      // Catatan: untuk relasi many-to-one, Supabase mengembalikan `warehouses`
      // sebagai OBJEK { name }, bukan array — tangani keduanya.
      const rows = (data ?? []) as {
        id: string;
        code: string;
        name: string;
        warehouses: { name: string }[] | { name: string } | null;
      }[];
      setLocationOptions(
        rows.map((r) => {
          const whName = Array.isArray(r.warehouses)
            ? r.warehouses[0]?.name ?? ""
            : r.warehouses?.name ?? "";
          return {
            value: r.id,
            label: whName ? `${whName} — ${r.name}` : r.name,
            code: r.code ?? "",
            warehouse: whName,
          };
        })
      );
    })();
    // Saran nama gerai dari riwayat permintaan (supaya ejaan konsisten di log).
    (async () => {
      const { data } = await supabase
        .from("requests")
        .select("branch_name")
        .not("branch_name", "is", null)
        .neq("branch_name", "")
        .order("branch_name")
        .limit(500);
      if (cancelled) return;
      const names = [...new Set(((data ?? []) as { branch_name: string }[]).map((r) => r.branch_name))];
      setGeraiOptions(names);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Lokasi Gudang Utama per jenis stok — kode STOK-* itu KHUSUS Gudang Utama.
  // Dipakai sebagai tujuan (Barang Masuk) dan sebagai asal (Barang Keluar).
  // Sengaja TIDAK ada fallback ke gudang lain: kalau kodenya tidak ketemu,
  // validasi gagal daripada stok nyasar ke gudang lain (kasus IN-2026-000037
  // yang masuk CEMPAKA PUTIH karena fallback alfabetis).
  const lokasiByJenis = useMemo(() => {
    const map: Record<string, LocationOption | undefined> = {};
    for (const key of Object.keys(JENIS_SUFFIX) as (keyof typeof JENIS_SUFFIX)[]) {
      map[key] = locationOptions.find(
        (l) => l.code.toUpperCase() === `STOK-${JENIS_SUFFIX[key]}`
      );
    }
    return map;
  }, [locationOptions]);
  const effectiveDestId = isMasuk ? lokasiByJenis[jenisStok]?.value ?? "" : destId;
  const effectiveSourceId = isKeluar ? lokasiByJenis[jenisStok]?.value ?? "" : sourceId;

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
    setJenisStok("");
    setGerai("");
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
    if (isKeluar) {
      if (!jenisStok) return "Pilih jenis stok (Baru / Retur / Unready).";
      if (!effectiveSourceId) return "Lokasi asal untuk jenis stok ini tidak ditemukan.";
    } else if (needSource && !sourceId) {
      return "Lokasi asal wajib dipilih.";
    }
    if (isMasuk) {
      if (!jenisStok) return "Pilih jenis stok (Baru / Retur / Unready).";
      if (!effectiveDestId) return "Lokasi tujuan untuk jenis stok ini tidak ditemukan.";
    } else if (needDest && !destId) {
      return "Lokasi tujuan wajib dipilih.";
    }
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
        .map((r) => ({
          item_id: r.item!.id,
          qty: Number(r.qty),
          // Barang Masuk & Keluar: gerai + jenis stok ikut tercatat per baris,
          // supaya kolom Gerai dan Jenis Stok di Log Transaksi terisi.
          ...(usesJenisStok && gerai.trim() ? { gerai: gerai.trim() } : {}),
          ...(usesJenisStok && jenisStok
            ? { status_aset: JENIS_STATUS_ASET[jenisStok as keyof typeof JENIS_STATUS_ASET] }
            : {}),
        }));
      const { data, error } = await supabase.rpc("post_inventory_transaction", {
        p_idempotency_key: crypto.randomUUID(),
        p_type: type,
        p_transaction_date: date,
        p_source_location_id: needSource ? effectiveSourceId || null : null,
        p_dest_location_id: needDest ? effectiveDestId || null : null,
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
        {needSource && !isKeluar && (
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
        {needDest && !isMasuk && (
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
        {usesJenisStok && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="trx-jenis" className="text-ink-100">Jenis Stok</Label>
              <Select
                id="trx-jenis"
                options={[...JENIS_STOK_OPTIONS]}
                placeholder="Pilih jenis stok"
                value={jenisStok}
                onValueChange={setJenisStok}
                className="border-white/15 bg-white/10 text-white [color-scheme:dark]"
              />
              {jenisStok && lokasiByJenis[jenisStok] && (
                <p className="text-xs text-ink-300">
                  {isMasuk ? "Tujuan" : "Asal"}: {lokasiByJenis[jenisStok]!.label}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="trx-gerai" className="text-ink-100">Gerai (opsional)</Label>
              <Input
                id="trx-gerai"
                list="trx-gerai-list"
                value={gerai}
                onChange={(e) => setGerai(e.target.value)}
                placeholder="cth: SiCepat Ekspres Bekasi Selatan LM"
                maxLength={100}
                className={DARK_INPUT}
              />
              <datalist id="trx-gerai-list">
                {geraiOptions.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </div>
          </>
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
