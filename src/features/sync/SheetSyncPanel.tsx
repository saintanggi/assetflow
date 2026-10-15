import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Save, Wifi, PlayCircle, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../../lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { formatDateTime } from "../../lib/format";

interface SyncSource {
  id: string;
  name: string;
  spreadsheet_id: string;
  sheet_mode: "newest" | "named";
  sheet_name: string | null;
  deduct_stock: boolean;
  allow_negative: boolean;
  auto_create_items: boolean;
  is_active: boolean;
  last_sheet: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_message: string | null;
  last_requests: number | null;
  last_items: number | null;
  last_qty: number | null;
}

interface SyncRun {
  id: string;
  started_at: string;
  status: string;
  sheet_name: string | null;
  requests_created: number;
  items_created: number;
  qty_imported: number | string;
  rows_skipped_dup: number;
  message: string | null;
  triggered_by: string;
}

const STATUS_LABEL: Record<string, string> = {
  sukses: "Sukses",
  gagal: "Gagal",
  sebagian: "Sebagian berhasil",
  jalan: "Sedang jalan",
};

/**
 * Panel sinkronisasi otomatis dari Google Sheet.
 * Sistem selalu membaca SHEET TERBARU (mis. "14 OKT") dan hanya mengimpor baris
 * yang belum pernah masuk, jadi aman dijalankan berkali-kali / tiap 15 menit.
 */
export function SheetSyncPanel() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [source, setSource] = useState<SyncSource | null>(null);
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<"newest" | "named">("newest");
  const [sheetName, setSheetName] = useState("");
  const [deductStock, setDeductStock] = useState(true);
  const [autoCreate, setAutoCreate] = useState(false);
  const [allowNegative, setAllowNegative] = useState(true);
  const [testResult, setTestResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("sheet_sync_sources")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) {
        // Tabel belum ada (migrasi belum dijalankan) — jangan bikin panik.
        if (/does not exist|schema cache/i.test(error.message)) {
          setSource(null);
          return;
        }
        throw new Error(error.message);
      }
      const src = (data ?? null) as SyncSource | null;
      setSource(src);
      if (src) {
        setUrl(`https://docs.google.com/spreadsheets/d/${src.spreadsheet_id}/edit`);
        setMode(src.sheet_mode);
        setSheetName(src.sheet_name ?? "");
        setDeductStock(src.deduct_stock);
        setAutoCreate(src.auto_create_items);
        setAllowNegative(src.allow_negative);
        const { data: runData } = await supabase
          .from("sheet_sync_runs")
          .select("*")
          .eq("source_id", src.id)
          .order("started_at", { ascending: false })
          .limit(5);
        setRuns((runData ?? []) as SyncRun[]);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memuat konfigurasi sinkronisasi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const callFn = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("sync-sheets", { body });
    if (error) {
      const detail = (await (error as { context?: Response }).context?.json?.().catch?.(() => null)) as
        | { error?: string }
        | null;
      const msg = detail?.error ?? error.message;
      if (/404|not found/i.test(msg)) {
        throw new Error(
          "Fungsi sync-sheets belum di-deploy. Ikuti docs/SHEET_SYNC.md (supabase functions deploy sync-sheets)."
        );
      }
      throw new Error(msg);
    }
    return data as Record<string, unknown>;
  };

  const save = async () => {
    setBusy("save");
    try {
      const body = {
        name: "Dokumen Pengiriman",
        spreadsheet_id: url,
        sheet_mode: mode,
        sheet_name: mode === "named" ? sheetName.trim() : null,
        deduct_stock: deductStock,
        allow_negative: allowNegative,
        auto_create_items: autoCreate,
        is_active: true,
      };
      const payload = { ...body, spreadsheet_id: extractId(url) ?? url };
      const { error } = source
        ? await supabase.from("sheet_sync_sources").update(payload).eq("id", source.id)
        : await supabase.from("sheet_sync_sources").insert(payload);
      if (error) throw new Error(error.message);
      toast.success("Konfigurasi sinkronisasi disimpan.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan.");
    } finally {
      setBusy(null);
    }
  };

  const testKoneksi = async () => {
    setBusy("test");
    setTestResult(null);
    try {
      const res = await callFn({ action: "test", spreadsheet_id: url });
      const terbaru = res.sheetTerbaru as string | null;
      setTestResult(
        `File terbaca. ${res.sheetsDenganData} sheet berisi data. Sheet terbaru: ${terbaru ?? "—"}` +
          (res.barisSheetTerbaru ? ` (${res.barisSheetTerbaru} baris)` : "")
      );
      toast.success("Koneksi ke Google Sheet OK.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal tes koneksi.");
    } finally {
      setBusy(null);
    }
  };

  const jalankan = async (mode2: "preview" | "run") => {
    setBusy(mode2);
    try {
      const res = await callFn({
        action: mode2,
        ...(source ? { source_id: source.id } : {}),
        spreadsheet_id: url,
        deduct_stock: deductStock,
        allow_negative: allowNegative,
        auto_create_items: autoCreate,
        sheet_mode: mode,
        sheet_name: mode === "named" ? sheetName.trim() : null,
      });
      if (mode2 === "preview") {
        const preview = (res.preview ?? []) as { item: string; kondisi: string; qty: number; rows: number }[];
        const ringkas = preview
          .slice(0, 6)
          .map((p) => `${p.item} (${p.qty})`)
          .join(", ");
        const tanpaMaster = Number(res.rowsTanpaMaster ?? 0);
        toast.success(
          `Sheet ${res.sheet}: ${res.rowsNew} baris baru dari ${res.rowsTotal} baris, ${res.qty} unit.` +
            (ringkas ? ` Contoh: ${ringkas}` : "")
        );
        if (tanpaMaster > 0) {
          toast.warning(
            `${tanpaMaster} baris dilewati karena nama barangnya belum ada di master ` +
              (autoCreate ? "(buat otomatis baru jalan saat Sinkron sekarang)." : "— aktifkan opsi buat barang otomatis.")
          );
        }
      } else {
        const gagal = (res.failures ?? []) as { ticket: string; detail: string }[];
        toast.success(
          `Sinkron selesai — sheet ${res.sheet}: ${res.requests} permintaan, ${res.qty} unit` +
            (res.rowsSkippedDup ? `, ${res.rowsSkippedDup} baris duplikat dilewati` : "") +
            (gagal.length ? `, ${gagal.length} gagal` : "")
        );
        if (gagal.length) toast.warning(gagal[0].detail);
      }
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sinkron gagal.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="font-display text-base text-white">Sinkron Google Sheet</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-xs text-slate-500">
          Sistem selalu membaca <span className="text-slate-300">sheet terbaru</span> (mis. “14 OKT”) dan hanya
          mengimpor baris yang belum pernah masuk — jadi bisa dijadwalkan otomatis tanpa risiko dobel.
        </p>

        <div className="space-y-1">
          <Label className="text-xs">Link Google Sheet (dokumen pengiriman)</Label>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/…/edit"
          />
          <p className="text-[11px] text-slate-500">
            Sharing file harus “Siapa saja yang memiliki link → Pelihat” agar bisa dibaca otomatis.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Sheet yang dipakai</Label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as "newest" | "named")}
              className="w-full rounded-md border border-white/15 bg-slate-900/70 px-2 py-1.5 text-xs text-slate-200"
            >
              <option value="newest">Selalu sheet terbaru</option>
              <option value="named">Sheet tertentu</option>
            </select>
          </div>
          {mode === "named" && (
            <div className="space-y-1">
              <Label className="text-xs">Nama sheet</Label>
              <Input value={sheetName} onChange={(e) => setSheetName(e.target.value)} placeholder="14 OKT" />
            </div>
          )}
        </div>

        <div className="space-y-2">
          <label className="flex cursor-pointer items-start gap-2 text-xs">
            <input type="checkbox" checked={deductStock} onChange={(e) => setDeductStock(e.target.checked)} className="mt-0.5" />
            <span className="text-slate-300">Kurangi stok otomatis (sesuai STATUS ASSET: Baru/Retur/Unready)</span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-xs">
            <input type="checkbox" checked={allowNegative} onChange={(e) => setAllowNegative(e.target.checked)} className="mt-0.5" />
            <span className="text-slate-300">Izinkan stok minus (dokumen lama / stok belum diisi)</span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-xs">
            <input type="checkbox" checked={autoCreate} onChange={(e) => setAutoCreate(e.target.checked)} className="mt-0.5" />
            <span className="text-slate-300">Buat barang baru otomatis bila nama belum ada di master</span>
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void testKoneksi()} disabled={!url || busy !== null}>
            <Wifi className="mr-1 h-4 w-4" /> Tes koneksi
          </Button>
          <Button size="sm" variant="outline" onClick={() => void save()} disabled={!url || busy !== null}>
            <Save className="mr-1 h-4 w-4" /> {source ? "Simpan" : "Simpan sumber"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void jalankan("preview")} disabled={!url || busy !== null}>
            <PlayCircle className="mr-1 h-4 w-4" /> Pratinjau
          </Button>
          <Button size="sm" onClick={() => void jalankan("run")} disabled={!url || busy !== null}>
            <RefreshCw className={`mr-1 h-4 w-4 ${busy === "run" ? "animate-spin" : ""}`} /> Sinkron sekarang
          </Button>
        </div>

        {testResult && (
          <div className="flex gap-2 rounded-md bg-brand-400/10 p-2 text-xs text-brand-200">
            <CheckCircle2 className="h-4 w-4 shrink-0" /> {testResult}
          </div>
        )}

        {source?.last_run_at && (
          <div className="rounded-md border border-white/10 p-3 text-xs">
            <p className="text-slate-300">
              Terakhir jalan {formatDateTime(source.last_run_at)} · sheet{" "}
              <span className="text-white">{source.last_sheet ?? "—"}</span> ·{" "}
              <span
                className={
                  source.last_status === "sukses"
                    ? "text-brand-300"
                    : source.last_status === "gagal"
                      ? "text-rose-300"
                      : "text-amber-300"
                }
              >
                {STATUS_LABEL[source.last_status ?? ""] ?? source.last_status}
              </span>
            </p>
            {source.last_message && <p className="mt-1 text-slate-500">{source.last_message}</p>}
          </div>
        )}

        {runs.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-slate-400">5 eksekusi terakhir</p>
            <ul className="space-y-1 text-[11px] text-slate-500">
              {runs.map((r) => (
                <li key={r.id} className="flex justify-between gap-2">
                  <span>
                    {formatDateTime(r.started_at)} · {r.sheet_name ?? "—"}
                  </span>
                  <span className={r.status === "sukses" ? "text-brand-300" : "text-amber-300"}>
                    {r.requests_created} permintaan / {Number(r.qty_imported)} unit
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!source && !loading && (
          <div className="flex gap-2 rounded-md bg-amber-400/10 p-2 text-xs text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              Belum ada sumber tersimpan. Isi link di atas lalu <b>Simpan sumber</b>. Untuk otomatis tiap 15 menit,
              ikuti <span className="font-mono">docs/SHEET_SYNC.md</span>.
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Ambil ID spreadsheet dari link Google Sheets. */
export function extractId(input: string): string | null {
  const raw = (input ?? "").trim();
  const m = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]{20,})/);
  if (m) return m[1];
  return /^[a-zA-Z0-9-_]{20,}$/.test(raw) ? raw : null;
}
