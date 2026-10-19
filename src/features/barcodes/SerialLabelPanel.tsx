import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Printer, Search, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabase";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Select } from "../../components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { SerialLabelSheet } from "./SerialLabelSheet";
import { DEFAULT_SHEET_OPTIONS, resolveSheetOptions, SHEET_PRESETS } from "./serialSheetLayout";
import type { SerialSheetOptions, SheetPreset } from "./serialSheetLayout";
import { printSerialLabels } from "./printSerialLabels";
import { allocateSerialLabels, fetchBatchLabels, labelError } from "./serialLabels";
import type { AllocationRequest, LabelBatch, LabelTarget, SerialLabel } from "./serialLabels";

export function SerialLabelPanel() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const storageKey = `assetflow:qr-request:${user?.id}`;
  const [pending, setPending] = useState<AllocationRequest | null>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as AllocationRequest | null;
      return saved && typeof saved.id === "string" && Number.isInteger(saved.quantity)
        && saved.quantity >= 1 && saved.quantity <= 500 && typeof saved.target?.id === "string"
        && typeof saved.target.name === "string" && ["asset", "item"].includes(saved.target.kind) ? saved : null;
    }
    catch { return null; }
  });
  const [kind, setKind] = useState<"asset" | "item">(pending?.target.kind ?? "item");
  const [target, setTarget] = useState<LabelTarget | null>(pending?.target ?? null);
  const [quantity, setQuantity] = useState(String(pending?.quantity ?? 1));
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LabelTarget[]>([]);
  const [searching, setSearching] = useState(false);
  const [batches, setBatches] = useState<LabelBatch[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [labels, setLabels] = useState<SerialLabel[]>([]);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [currentTitle, setCurrentTitle] = useState("");
  const [lookup, setLookup] = useState("");
  const [sheetOptions, setSheetOptions] = useState<SerialSheetOptions>(() => {
    try {
      const saved = localStorage.getItem("assetflow:qr-sheet-template:v1");
      return saved ? resolveSheetOptions(JSON.parse(saved)) : DEFAULT_SHEET_OPTIONS;
    } catch { return DEFAULT_SHEET_OPTIONS; }
  });
  useEffect(() => {
    try { localStorage.setItem("assetflow:qr-sheet-template:v1", JSON.stringify(sheetOptions)); }
    catch { /* Pengaturan tampilan opsional; penomoran tetap hanya di server. */ }
  }, [sheetOptions]);
  const selectedCodes = labels.filter((row) => selection.has(row.code)).map((row) => row.code).sort();
  const perSheet = 4 * SHEET_PRESETS[sheetOptions.preset].rows;
  const sheetCount = Math.ceil(selectedCodes.length / perSheet);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setHistoryError("");
    try {
      const { data, error: err } = await supabase.from("qr_label_batches")
        .select("id, title, asset_id, item_id, quantity, created_at, created_by")
        .order("created_at", { ascending: false }).order("id").range(page * 20, page * 20 + 19);
      if (err) throw err;
      setBatches((data ?? []) as LabelBatch[]);
    } catch (err) { setHistoryError(labelError(err)); }
    finally { setLoading(false); }
  }, [page]);
  useEffect(() => { void loadHistory(); }, [loadHistory]);

  // Tautan dari detail aset/barang tetap bisa dipakai di mesin QR baru.
  useEffect(() => {
    const assetId = params.get("asset");
    const itemId = params.get("sku");
    if (pending || (!assetId && !itemId)) return;
    let cancelled = false;
    void (async () => {
      const isAsset = Boolean(assetId);
      const { data, error: err } = await supabase.from(isAsset ? "assets" : "inventory_items")
        .select(isAsset ? "id, asset_code, name" : "id, sku, name").eq("id", assetId ?? itemId).maybeSingle();
      if (cancelled) return;
      if (err) { setError(labelError(err)); return; }
      if (data) {
        const row = data as unknown as { id: string; name: string; asset_code?: string; sku?: string };
        setKind(isAsset ? "asset" : "item");
        setTarget({ id: row.id, name: row.name, code: row.asset_code ?? row.sku ?? "", kind: isAsset ? "asset" : "item" });
        setQuantity("1");
      }
    })();
    return () => { cancelled = true; };
    // Hanya preload ketika tautan berubah, bukan setelah permintaan selesai.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  useEffect(() => {
    let cancelled = false;
    setResults([]);
    setSearching(false);
    const term = query.trim().replace(/[%_,().\\]/g, "");
    if (term.length < 2 || pending) return;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void (async () => {
        const codeColumn = kind === "asset" ? "asset_code" : "sku";
        let request = supabase.from(kind === "asset" ? "assets" : "inventory_items")
          .select(`id, name, ${codeColumn}`).or(`${codeColumn}.ilike.%${term}%,name.ilike.%${term}%`).limit(10);
        if (kind === "asset") request = request.eq("archived", false);
        const { data, error: err } = await request;
        if (cancelled) return;
        setSearching(false);
        if (err) { setError(labelError(err)); return; }
        setResults(((data ?? []) as unknown as Record<string, string>[]).map((row) => ({
          id: row.id, name: row.name, code: row[codeColumn], kind,
        })));
      })();
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, kind, pending]);

  const showLabels = (rows: SerialLabel[], title: string) => {
    setLabels(rows);
    setSelection(new Set(rows.map((row) => row.code)));
    setCurrentTitle(title);
  };

  const allocate = async () => {
    if (inFlight.current) return;
    const count = Number(quantity);
    if (!pending && (!target || !Number.isInteger(count) || count < 1 || count > 500 || (target.kind === "asset" && count !== 1))) {
      setError("Pilih satu aset (1 label) atau barang dengan jumlah bulat 1–500 label.");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const request = pending ?? { id: crypto.randomUUID(), target: target!, quantity: count };
      // Simpan SEBELUM RPC: retry/refresh tab menggunakan UUID yang sama saat respons hilang.
      sessionStorage.setItem(storageKey, JSON.stringify(request));
      setPending(request);
      const rows = await allocateSerialLabels(request);
      showLabels(rows, request.target.name);
      sessionStorage.removeItem(storageKey);
      setPending(null);
      toast.success("Nomor tersimpan. Silakan periksa pratinjau, lalu cetak.");
      void loadHistory();
    } catch (err) { setError(labelError(err)); }
    finally { inFlight.current = false; setBusy(false); }
  };

  const openBatch = async (batch: LabelBatch) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try { showLabels(await fetchBatchLabels(batch.id), batch.title); }
    catch (err) { setError(labelError(err)); }
    finally { inFlight.current = false; setBusy(false); }
  };

  const findNumber = async () => {
    if (inFlight.current) return;
    if (!/^\d{12}$/.test(lookup.trim())) { setError("Masukkan 12 digit nomor barcode."); return; }
    inFlight.current = true; setBusy(true); setError("");
    try {
      const { data, error: err } = await supabase.from("qr_serial_labels").select("number, code, batch_id")
        .eq("code", lookup.trim()).maybeSingle();
      if (err) throw err;
      if (!data) throw new Error("Nomor barcode tidak ditemukan.");
      showLabels([data as SerialLabel], "Cetak ulang per nomor");
    } catch (err) { setError(labelError(err)); }
    finally { inFlight.current = false; setBusy(false); }
  };

  const print = async () => {
    if (inFlight.current || selection.size === 0) return;
    if (!window.confirm(`Cetak ${selection.size} label? Untuk cetak ulang, pastikan label lama dilepas/rusak agar tidak ada dua label aktif pada barang berbeda.`)) return;
    inFlight.current = true; setBusy(true); setError("");
    try { await printSerialLabels(selectedCodes, sheetOptions); }
    catch (err) { setError(labelError(err)); }
    finally { inFlight.current = false; setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <strong>Kertas 100 × 150 mm • Label 20 × 15 mm • Nomor bersama</strong>
        <p className="mt-1">Nomor baru berlanjut otomatis untuk semua pengguna di database yang sama. Cetak ulang memakai nomor lama, bukan membuat nomor baru. Tidak mengubah stok.</p>
      </div>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>1. Buat nomor baru</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-ink-500">Barang/SKU: satu nomor per unit fisik. Aset: satu nomor tetap; permintaan berikutnya menampilkan nomor yang sama.</p>
            {pending && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Ada permintaan belum terkonfirmasi. Klik “Coba lagi” untuk mengambil hasil dengan kunci yang sama, tanpa membuat batch ganda.</p>}
            <div><Label htmlFor="qr-kind">Jenis</Label><Select id="qr-kind" options={[{ value: "item", label: "Barang / SKU (per unit)" }, { value: "asset", label: "Aset terdaftar" }]} value={kind} disabled={busy || !!pending} onChange={(e) => {
              setKind(e.target.value as "asset" | "item"); setTarget(null); setQuery(""); setQuantity("1");
            }} /></div>
            <div><Label htmlFor="qr-search">Cari kode / nama {kind === "asset" ? "aset" : "barang"}</Label>
              <Input id="qr-search" value={query} disabled={busy || !!pending} placeholder="Ketik minimal 2 huruf" onChange={(e) => setQuery(e.target.value)} />
              {searching && <p className="text-sm text-ink-500">Mencari…</p>}
              {results.length > 0 && <ul className="mt-2 divide-y rounded-lg border">{results.map((row) => <li key={row.id}>
                <button type="button" className="w-full p-3 text-left text-sm hover:bg-ink-50" onClick={() => { setTarget(row); setQuery(""); setResults([]); }} disabled={busy}>
                  <strong>{row.code}</strong> — {row.name}
                </button></li>)}</ul>}
            </div>
            {target && <p className="rounded-lg bg-ink-50 p-3 text-sm">Dipilih: <strong>{target.code} — {target.name}</strong></p>}
            <div><Label htmlFor="qr-quantity">Jumlah unit / label</Label><Input id="qr-quantity" type="number" min={1} max={kind === "asset" ? 1 : 500} step={1}
              value={quantity} disabled={busy || !!pending || kind === "asset"} onChange={(e) => setQuantity(e.target.value)} /></div>
            <Button onClick={() => void allocate()} disabled={busy || (!target && !pending)}>{busy ? "Memproses…" : pending ? "Coba lagi (permintaan yang sama)" : "Simpan & buat nomor"}</Button>
            <p className="text-xs text-ink-500">Nomor dicadangkan saat disimpan, bukan saat kertas keluar. Batal cetak tidak mengembalikan nomor; gunakan riwayat untuk melanjutkan.</p>
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader><CardTitle>2. Pratinjau & cetak</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-ink-500">Printer: kertas <strong>100 × 150 mm (portrait)</strong>, skala <strong>100% / Actual size</strong>, margin printer 0, matikan header/footer dan “Fit to page”. Tiap stiker tetap <strong>20 × 15 mm</strong>.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label htmlFor="qr-sheet-preset">Susunan per lembar</Label><Select id="qr-sheet-preset" value={sheetOptions.preset} disabled={busy}
                options={Object.entries(SHEET_PRESETS).map(([value, layout]) => ({ value, label: layout.title }))}
                onChange={(e) => setSheetOptions((prev) => ({ ...prev, preset: e.target.value as SheetPreset }))} /></div>
              <div><Label htmlFor="qr-sheet-header">Tulisan atas label</Label><Input id="qr-sheet-header" value={sheetOptions.header} maxLength={24} disabled={busy}
                placeholder="Contoh: SiCepat" onChange={(e) => setSheetOptions((prev) => ({ ...prev, header: e.target.value }))} /></div>
            </div>
            <p className="text-xs text-ink-500">Bingkai + nama di atas, QR di tengah, nomor di bawah. Urutan kiri → kanan, lalu baris berikutnya. Lebih dari {perSheet} label otomatis lanjut ke lembar baru. Ubah template tidak mengubah nomor.</p>
            <p className="text-xs text-ink-500">QR menyimpan 12 digit nomor yang tercetak, bukan URL. Pindai lewat menu Scanner aplikasi untuk membuka aset/barang.</p>
            {labels.length ? <>
              <p className="text-sm font-semibold">{currentTitle} · {labels.length} label</p>
              <div className="flex flex-wrap gap-2"><Button disabled={busy || !selection.size} onClick={() => void print()}><Printer className="mr-2 h-4 w-4" />Cetak {selection.size} label</Button>
                <Button variant="outline" disabled={busy} onClick={() => setSelection(selection.size === labels.length ? new Set() : new Set(labels.map((row) => row.code)))}>{selection.size === labels.length ? "Batal pilih semua" : "Pilih semua"}</Button></div>
              <p role="status" className="text-sm">{selection.size} label terpilih · {sheetCount} lembar · {perSheet} label per lembar</p>
              <fieldset className="rounded-lg border p-3">
                <legend className="px-1 text-xs text-ink-500">Pilih nomor yang dicetak</legend>
                <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto">
                  {labels.map((row) => <label key={row.code} className="flex cursor-pointer items-center gap-1 rounded border px-2 py-1 font-mono text-xs">
                    <input type="checkbox" aria-label={`Pilih ${row.code}`} checked={selection.has(row.code)} disabled={busy} onChange={() => setSelection((prev) => {
                      const next = new Set(prev); if (next.has(row.code)) next.delete(row.code); else next.add(row.code); return next;
                    })} />{row.code}
                  </label>)}
                </div>
              </fieldset>
              <p className="text-xs text-ink-500">Pratinjau lembar yang akan dicetak. Pilihan label dirapatkan mulai kiri atas; sisa lembar terakhir dibiarkan kosong. Garis tepi label ikut dicetak.</p>
              {selectedCodes.length > 0 ? <div className="max-h-[650px] overflow-auto rounded-lg bg-ink-100 p-3">
                <div className="flex w-max flex-col gap-4" data-testid="serial-sheet-preview">
                  <SerialLabelSheet codes={selectedCodes} options={sheetOptions} />
                </div>
              </div> : <p className="text-sm text-ink-500">Pilih minimal satu nomor untuk melihat pratinjau.</p>}

            </> : <p className="py-8 text-center text-sm text-ink-500">Buat nomor baru atau buka riwayat untuk melihat label.</p>}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Riwayat nomor tersimpan / cetak ulang</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-ink-500">Riwayat ini mencatat penerbitan nomor, bukan bukti kertas berhasil dicetak. Semua pengguna berizin dapat membuka batch yang sama.</p>
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void findNumber(); }}>
            <div><Label htmlFor="qr-lookup">Cari nomor barcode</Label><Input id="qr-lookup" inputMode="numeric" maxLength={12} placeholder="000000000001" value={lookup} onChange={(e) => setLookup(e.target.value)} /></div>
            <Button type="submit" variant="outline" disabled={busy}><Search className="mr-2 h-4 w-4" />Cari untuk cetak ulang</Button>
            <Button type="button" variant="outline" onClick={() => void loadHistory()} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Muat ulang riwayat</Button>
          </form>
          {historyError && <p role="alert" className="text-sm text-red-700">{historyError}</p>}
          {loading ? <p className="text-sm">Memuat riwayat…</p> : <ul className="divide-y">{batches.map((batch) => <li key={batch.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <div><strong>{batch.title}</strong> · {batch.quantity} label · {batch.asset_id ? "Aset" : "Barang"}
              <p className="text-xs text-ink-500">{new Date(batch.created_at).toLocaleString("id-ID")} · Batch {batch.id}</p></div>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void openBatch(batch)}>Buka / cetak ulang</Button>
          </li>)}</ul>}
          {!loading && !batches.length && !historyError && <p className="text-sm text-ink-500">Belum ada batch pada halaman ini.</p>}
          <div className="flex items-center gap-3"><Button variant="outline" disabled={loading || page === 0} onClick={() => setPage((n) => n - 1)}>Sebelumnya</Button><span className="text-sm">Halaman {page + 1}</span><Button variant="outline" disabled={loading || batches.length < 20} onClick={() => setPage((n) => n + 1)}>Berikutnya</Button></div>
        </CardContent>
      </Card>
    </div>
  );
}
