import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Download, Upload, FileSpreadsheet, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { formatDate } from "../lib/format";
import { SheetSyncPanel } from "../features/sync/SheetSyncPanel";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import {
  SHIPPING_HEADERS,
  aggregateGroup,
  asetLabelOf,
  buildDupIndex,
  filterDuplicateRows,
  findDuplicateRowsInFile,
  groupKeyOf,
  parseSheetLabel,
  parseWorkbook,
  pickNewestSheet,
  type AggLine,
  type DupIndex,
  type KodeKondisi,
  type ParsedShippingRow,
  type SheetCandidate,
  type StoredItemRow,
} from "../lib/shippingUpload";

// Ubah pesan error teknis (berisi UUID) menjadi bahasa yang mudah dipahami.
function formatShipError(raw: string, itemNameById: Map<string, string>): string {
  // Pola: Stok tidak mencukupi (item <uuid>, lokasi <uuid>): tersedia X, perubahan -Y
  const m = raw.match(/Stok tidak mencukupi \(item ([0-9a-f-]{36})/i);
  if (m) {
    const itemName = itemNameById.get(m[1]) ?? "barang";
    const avail = raw.match(/tersedia ([\d.,]+)/i)?.[1] ?? "?";
    const need = raw.match(/perubahan -([\d.,]+)/i)?.[1] ?? "?";
    return `${itemName}: stok tidak cukup (tersedia ${avail}, dibutuhkan ${need}). Isi stok dulu atau matikan "Kurangi stok otomatis".`;
  }
  // Pola lain dari RPC: bersihkan UUID yang tersisa.
  return raw
    .replace(/Gagal kirim [A-Z0-9-]+:\s*/i, "")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]")
    .trim() || "gagal tanpa keterangan";
}

interface Preview {
  /** Semua baris valid di file (belum difilter duplikat) — dipakai ulang saat import. */
  rows: ParsedShippingRow[];
  /** Baris yang akan diimpor (setelah baris duplikat dibuang). */
  kept: ParsedShippingRow[];
  /** Baris yang dilewati karena sudah ada di sistem. */
  skipped: ParsedShippingRow[];
  /** Baris dengan tiket+barang+barcode/resi sama di dalam file itu sendiri. */
  dupsInFile: ParsedShippingRow[];
  /** Total per barang + kondisi + status terkirim (yang akan masuk ke sistem). */
  lines: AggLine[];
  idByName: Map<string, string>;
  nameById: Map<string, string>;
  /** Sheet yang sedang dipratinjau (nama sheet di file Excel). */
  sheetName: string;
  /** Semua sheet yang bisa dipilih dari file yang di-upload. */
  sheetOptions: { name: string; count: number }[];
  groups: number;
  unmatched: string[];
  existingTickets: string[];
}

const uuid = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });

/** Pecah array jadi beberapa batch (batas panjang URL PostgREST). */
function batches<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function RequestUploadPage() {
  const { user, hasPermission } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [fileName, setFileName] = useState("");
  const [deductStock, setDeductStock] = useState(true);
  const [autoCreate, setAutoCreate] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [failList, setFailList] = useState<{ ticket: string; detail: string }[]>([]);
  const [sheetOptions, setSheetOptions] = useState<{ name: string; count: number }[]>([]);
  const sheetCache = useRef<Map<string, SheetCandidate>>(new Map());

  const canShip = hasPermission("requests.review");

  const downloadTemplate = async () => {
    try {
      const { data: items } = await supabase
        .from("inventory_items")
        .select("sku, name")
        .eq("is_active", true)
        .order("name")
        .limit(5000);
      const wb = XLSX.utils.book_new();
      const example = ["2026-10-13","A2610130001","Jakarta Sortation","","KOMPUTER RAKITAN",3,
        "V3165SB380260700885","","A130025539","","","ASSET BARU","TERKIRIM"];
      XLSX.utils.book_append_sheet(wb,
        XLSX.utils.aoa_to_sheet([[...SHIPPING_HEADERS], example]), "PENGIRIMAN");
      const tips = [
        ["PETUNJUK PENGISIAN TEMPLATE DOKUMEN PENGIRIMAN"],
        [""],
        ["1. Isi data pada sheet PENGIRIMAN mulai baris 3 (baris 1 header, baris 2 contoh — contoh boleh dihapus)."],
        ["2. In Progress Date: tanggal pengiriman (format YYYY-MM-DD, dd/mm/yyyy, atau 14-Oct-26)."],
        ["3. NAMA BARANG: samakan dengan sheet DAFTAR BARANG (huruf besar/kecil bebas)."],
        ["4. QTY = jumlah barang pada baris itu dan dianggap paling benar (mis. 23 kursi → tulis 23)."],
        ["5. Baris lanjutan (mis. 1 sel QTY di-merge untuk beberapa baris/resi): biarkan QTY kosong — baris tanpa QTY dan tanpa BARCODE tidak menambah qty, hanya mencatat RESI/KETERANGAN."],
        ["6. QTY kosong tetapi BARCODE terisi = dihitung 1 unit."],
        ["7. STATUS ASSET menentukan stok mana yang dipotong: ASSET BARU → stok Baru, ASSET RETUR/RETURN → stok Return, ASSET UNREADY → stok Unready. Kosong = dianggap ASSET BARU."],
        ["8. STATUS TERKIRIM: TERKIRIM atau PENDING. Baris PENDING masuk dashboard Sisa Belum Terkirim."],
        ["9. Upload file terisi di menu ini (Upload Dokumen) — periksa tabel pratinjau, pastikan QTY sudah sesuai file sebelum klik Import."],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tips), "PETUNJUK");
      const daftar = [["KODE","NAMA BARANG (pakai nama ini di kolom NAMA BARANG)"],
        ...(((items ?? []) as { sku: string; name: string }[]).map((x) => [x.sku, x.name]))];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(daftar), "DAFTAR BARANG");
      XLSX.writeFile(wb, "Template_Upload_Pengiriman.xlsx");
    } catch {
      toast.error("Gagal membuat template.");
    }
  };

  /**
   * Ambil "sidik jari" baris yang sudah pernah diimpor (tiket + barang + barcode/resi)
   * supaya upload ulang file yang sama tidak menggandakan qty.
   */
  const loadExisting = async (
    rows: ParsedShippingRow[],
  ): Promise<{ index: DupIndex; existingTickets: string[] }> => {
    const tickets = [...new Set(rows.map((r) => r.ticket).filter(Boolean))];
    const dates = [...new Set(rows.map((r) => r.date))];
    if (tickets.length === 0 || dates.length === 0) return { index: buildDupIndex([]), existingTickets: [] };
    const stored: StoredItemRow[] = [];
    const existingTickets = new Set<string>();
    for (const tBatch of batches(tickets, 60)) {
      for (const dBatch of batches(dates, 60)) {
        const { data: reqs, error } = await supabase
          .from("requests")
          .select("id, ticket_no, request_date")
          .in("ticket_no", tBatch)
          .in("request_date", dBatch)
          .limit(3000);
        if (error) throw new Error(error.message);
        const reqs2 = (reqs ?? []) as { id: string; ticket_no: string; request_date: string }[];
        if (reqs2.length === 0) continue;
        for (const r of reqs2) existingTickets.add(r.ticket_no);
        const reqById = new Map(reqs2.map((r) => [r.id, r]));
        for (const idBatch of batches([...reqById.keys()], 80)) {
          const { data: items, error: itErr } = await supabase
            .from("request_items")
            .select("request_id, item_id, barcode, resi, qty_requested")
            .in("request_id", idBatch)
            .limit(5000);
          if (itErr) throw new Error(itErr.message);
          for (const it of (items ?? []) as {
            request_id: string;
            item_id: string;
            barcode: string | null;
            resi: string | null;
            qty_requested: number | string;
          }[]) {
            const req = reqById.get(it.request_id);
            if (!req) continue;
            stored.push({
              ticket_no: req.ticket_no,
              request_date: req.request_date,
              item_id: it.item_id,
              barcode: it.barcode,
              resi: it.resi,
              qty_requested: it.qty_requested,
            });
          }
        }
      }
    }
    return { index: buildDupIndex(stored), existingTickets: [...existingTickets] };
  };

  /**
   * Bangun pratinjau dari baris satu sheet: cocokkan barang, buang baris yang sudah
   * pernah masuk, lalu agregasi qty per barang + kondisi aset.
   */
  const buildPreview = async (rows: ParsedShippingRow[], sheetName: string) => {
    // Cocokkan nama barang dengan master.
      const { data: items, error: itemsErr } = await supabase
        .from("inventory_items")
        .select("id, name")
        .eq("is_active", true)
        .limit(5000);
      if (itemsErr) throw new Error(itemsErr.message);
      const idByName = new Map<string, string>();
      const nameById = new Map<string, string>();
      for (const it of (items ?? []) as { id: string; name: string }[]) {
        idByName.set(it.name.trim().toUpperCase(), it.id);
        nameById.set(it.id, it.name);
      }
      const keyOf = (r: ParsedShippingRow): string =>
        idByName.get(r.itemName.toUpperCase()) ?? `NAME:${r.itemName.toUpperCase()}`;
      const unmatched = [
        ...new Set(rows.filter((r) => !idByName.has(r.itemName.toUpperCase())).map((r) => r.itemName)),
      ];

      // Baris yang sudah pernah masuk (upload ulang file yang sama) dibuang.
      const { index, existingTickets } = await loadExisting(rows);
      const { kept, skipped } = filterDuplicateRows(rows, keyOf, index);
      const dupsInFile = findDuplicateRowsInFile(kept, keyOf);
      const lines = aggregateGroup(kept, keyOf);
      const groups = new Set(kept.map(groupKeyOf));

    setPreview({
      rows,
      kept,
      skipped,
      dupsInFile,
      lines,
      idByName,
      nameById,
      sheetName,
      sheetOptions: [...sheetCache.current.entries()].map(([name, c]) => ({ name, count: c.rows.length })),
      groups: groups.size,
      unmatched,
      existingTickets,
    });
    if (skipped.length > 0)
      toast.warning(`${skipped.length} baris sudah ada di sistem — akan dilewati.`);
  };

  const handleFile = async (f: File) => {
    setPreview(null);
    setResult(null);
    setFailList([]);
    setFileName(f.name);
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { cellDates: true });
      const parsed = parseWorkbook(wb);
      if (parsed.sheets.length === 0) {
        toast.error(
          "Tidak ada sheet berisi tabel pengiriman (kolom NAMA BARANG). Pastikan memakai template yang disediakan."
        );
        return;
      }
      // File gabungan (mis. satu sheet per tanggal): pilih sheet dengan data terbanyak,
      // sisanya bisa dipilih lewat dropdown.
      // Sistem selalu mulai dari sheet terbaru (nama sheet bertanggal, mis. "14 OKT").
      const terbaru = pickNewestSheet(parsed.sheets) ?? parsed.sheets[0];
      const tanggalSheet = parseSheetLabel(terbaru.name).date;
      sheetCache.current = new Map(parsed.sheets.map((sh) => [sh.name, sh]));
      setSheetOptions(parsed.sheets.map((sh) => ({ name: sh.name, count: sh.rows.length })));
      if (parsed.sheets.length > 1) {
        toast.info(
          `File punya ${parsed.sheets.length} sheet data — diproses sheet terbaru: "${terbaru.name}"` +
            (tanggalSheet ? ` (${formatDate(tanggalSheet)})` : "") + "."
        );
      }
      await buildPreview(terbaru.rows, terbaru.name);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal membaca file.");
    }
  };

  const changeSheet = async (name: string) => {
    if (!sheetCache.current.has(name)) return;
    setPreview(null);
    setResult(null);
    try {
      await buildPreview(sheetCache.current.get(name)!.rows, name);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal membaca sheet.");
    }
  };

  const runImport = async () => {
    if (!preview) return;
    if (deductStock && !canShip) {
      toast.error("Opsi kurangi stok butuh akses Admin Gudang (requests.review).");
      return;
    }
    setImporting(true);
    setResult(null);
    try {
      // 1) Match / buat barang.
      setProgress("Mencocokkan barang…");
      const { data: items } = await supabase
        .from("inventory_items")
        .select("id, name")
        .eq("is_active", true)
        .limit(5000);
      const byName = new Map<string, string>();
      const itemNameById = new Map<string, string>();
      for (const it of (items ?? []) as { id: string; name: string }[]) {
        byName.set(it.name.trim().toUpperCase(), it.id);
        itemNameById.set(it.id, it.name);
      }

      if (autoCreate) {
        const missing = [...new Set(preview.rows.map((r) => r.itemName).filter((n) => !byName.has(n.toUpperCase())))];
        const { data: units } = await supabase.from("units").select("id, code").limit(50);
        const pcsUnit = ((units ?? []) as { id: string; code: string }[]).find((u) => u.code.toUpperCase() === "PCS")
          ?? (units?.[0] as { id: string } | undefined);
        if (!pcsUnit) throw new Error("Tabel satuan kosong — hubungi super admin.");
        for (let i = 0; i < missing.length; i += 50) {
          const batch = missing.slice(i, i + 50);
          const withSku = batch.map((n, j) => ({
            sku: `UPL-${Date.now().toString(36).toUpperCase()}-${i + j}`,
            name: n,
            unit_id: pcsUnit.id,
            is_active: true,
          }));
          const { data: created, error } = await supabase.from("inventory_items").insert(withSku).select("id, name");
          if (error) throw new Error(`Gagal membuat barang: ${error.message}`);
          for (const c of (created ?? []) as { id: string; name: string }[])
            byName.set(c.name.trim().toUpperCase(), c.id);
          setProgress(`Membuat barang baru… ${Math.min(i + 50, missing.length)}/${missing.length}`);
        }
      } else if (preview.unmatched.length > 0) {
        const names = preview.unmatched.slice(0, 10).join(", ");
        throw new Error(
          `${preview.unmatched.length} nama barang tidak ada di master dan opsi buat-otomatis mati: ${names}${preview.unmatched.length > 10 ? "…" : ""}. Tambahkan dulu di Master Barang atau aktifkan "Buat barang baru otomatis".`
        );
      }

      // 2) Buang baris duplikat (dihitung ulang dari seluruh baris file, urutannya sama
      //    seperti pratinjau supaya hasilnya konsisten).
      setProgress("Mengecek duplikat…");
      const keyOf = (r: ParsedShippingRow): string => byName.get(r.itemName.toUpperCase()) ?? "";
      const { index } = await loadExisting(preview.rows);
      const { kept: filteredRows, skipped } = filterDuplicateRows(preview.rows, keyOf, index);
      const skippedDup = skipped.length;

      // 3) Kelompokkan per permintaan (tanggal + gerai + tiket).
      const groups = new Map<string, ParsedShippingRow[]>();
      for (const r of filteredRows) {
        const key = groupKeyOf(r);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(r);
      }

      // Lokasi kanonis per kondisi untuk pengurangan stok.
      const locByKondisi = new Map<KodeKondisi, string>();
      if (deductStock) {
        const { data: locs } = await supabase
          .from("locations")
          .select("id, code")
          .in("code", ["STOK-BARU", "STOK-RETUR", "STOK-UNREADY"]);
        for (const l of ((locs ?? []) as { id: string; code: string }[])) {
          locByKondisi.set(l.code as KodeKondisi, l.id);
        }
        if (!locByKondisi.has("STOK-BARU")) {
          throw new Error("Lokasi STOK-BARU belum ada — jalankan migrasi 0010 dulu.");
        }
      }

      let reqCount = 0;
      let itemCount = 0;
      let totalQty = 0;
      const failures: { ticket: string; detail: string }[] = [];
      let n = 0;
      for (const rs of groups.values()) {
        n++;
        const first = rs[0];
        const ticket = first.ticket || null;
        setProgress(`Mengimpor permintaan ${n}/${groups.size}…`);
        let reqId: string | null = null;
        try {
          // Baris per barang + kondisi aset + status terkirim.
          const lines = aggregateGroup(rs, (r) => {
            const id = byName.get(r.itemName.toUpperCase());
            if (!id) throw new Error(`Barang tidak ditemukan: ${r.itemName}`);
            return id;
          });
          const hasPending = lines.some((l) => l.isPending);
          const { data: req, error: reqErr } = await supabase
            .from("requests")
            .insert({
              ticket_no: ticket ?? `UPL-${first.date}-${n}`,
              request_date: first.date,
              branch_name: first.branch,
              branch_code: first.branchCode || null,
              status: "disetujui",
              notes: "Upload dokumen pengiriman (otomatis disetujui).",
              requested_by: user?.id ?? null,
              reviewed_by: user?.id ?? null,
              reviewed_at: new Date().toISOString(),
            })
            .select("id")
            .single();
          if (reqErr) throw new Error(reqErr.message);
          reqId = req.id;

          // Id baris dibuat di sisi klien supaya pemetaan hasil insert -> baris import
          // tidak bergantung pada urutan balikan PostgREST.
          const planned = lines.map((line) => ({ line, id: uuid() }));
          const payload = planned.map(({ line, id }) => ({
            id,
            request_id: req.id,
            item_id: line.itemKey,
            qty_requested: line.qty,
            qty_approved: line.qty,
            qty_shipped: 0,
            barcode: [...new Set(line.rows.map((x) => x.barcode).filter(Boolean))].join("\n") || null,
            item_type: line.rows[0].typeBarang || null,
            status_aset: line.rows[0].statusAset || null,
            resi: [...new Set(line.rows.map((x) => x.resi).filter(Boolean))].join("\n") || null,
            item_status: line.isPending ? "pending_sebagian" : "disetujui",
            notes: [...new Set(line.rows.map((x) =>
              [x.ket && `Ket: ${x.ket}`, x.statusRequest && `Status request: ${x.statusRequest}`]
                .filter(Boolean).join(" | ")
            ).filter(Boolean))].join("\n") || null,
          }));
          const { error: itemsErr } = await supabase.from("request_items").insert(payload);
          if (itemsErr) throw new Error(itemsErr.message);
          reqCount++;
          itemCount += payload.length;
          totalQty += lines.reduce((s, l) => s + l.qty, 0);

          if (deductStock) {
            // Kelompokkan item TERKIRIM (bukan PENDING) per kondisi:
            // RETUR/RETURN → STOK-RETUR, UNREADY → STOK-UNREADY, lainnya → STOK-BARU.
            const byKondisi = new Map<KodeKondisi, { request_item_id: string; qty: number; resi: string }[]>();
            for (const { line, id } of planned) {
              if (line.isPending) continue;
              const list = byKondisi.get(line.kodeKondisi) ?? [];
              list.push({ request_item_id: id, qty: line.qty, resi: line.rows.map((x) => x.resi).find(Boolean) ?? "" });
              byKondisi.set(line.kodeKondisi, list);
            }
            for (const [kode, plines] of byKondisi) {
              const locId = locByKondisi.get(kode);
              if (!locId) throw new Error(`Lokasi ${kode} belum ada di database.`);
              const { error: shipErr } = await supabase.rpc("ship_request_items", {
                p_request_id: req.id,
                p_location_id: locId,
                p_lines: plines,
                p_notes: `Upload dokumen pengiriman ${ticket ?? ""} (${kode})`.trim(),
                p_allow_negative: true,
              });
              if (shipErr) throw new Error(`Gagal kirim ${ticket ?? req.id} [${kode}]: ${shipErr.message}`);
            }
            if (hasPending) {
              await supabase
                .from("requests")
                .update({ status: "disetujui_sebagian" })
                .eq("id", req.id);
            }
          } else {
            // Tandai selesai/pending tanpa ubah stok.
            for (const { line, id } of planned) {
              await supabase
                .from("request_items")
                .update({
                  qty_shipped: line.isPending ? 0 : line.qty,
                  item_status: line.isPending ? "pending_sebagian" : "terkirim",
                })
                .eq("id", id);
            }
            await supabase
              .from("requests")
              .update({ status: hasPending ? "disetujui_sebagian" : "selesai" })
              .eq("id", req.id);
          }
        } catch (e) {
          // Gagal di satu permintaan: hapus request yang sudah terbuat (rollback parsial), catat, lanjut.
          if (reqId) await supabase.from("requests").delete().eq("id", reqId);
          const rawMsg = e instanceof Error ? e.message : "gagal";
          failures.push({
            ticket: ticket ?? `baris grup ${n}`,
            detail: formatShipError(rawMsg, itemNameById),
          });
        }
      }

      setFailList(failures);
      const failMsg = failures.length > 0 ? ` Gagal: ${failures.length} permintaan (lihat rincian di bawah).` : "";
      const dupMsg = skippedDup > 0 ? ` ${skippedDup} baris duplikat dilewati.` : "";
      const emptyMsg = filteredRows.length === 0 ? " Tidak ada baris baru untuk diimpor." : "";
      setResult(
        `Berhasil: ${reqCount} permintaan, ${itemCount} baris barang (total qty ${totalQty}).${deductStock ? " Stok otomatis berkurang." : ""}${dupMsg}${emptyMsg}${failMsg}`
      );
      if (failures.length > 0) toast.warning(`${failures.length} permintaan gagal — lihat rincian.`);
      else toast.success("Import selesai.");
      setPreview(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mengimpor.");
    } finally {
      setImporting(false);
      setProgress("");
    }
  };

  const nameOf = (line: AggLine): string => line.itemName;

  return (
    <div>
      <PageHeader
        title="Upload Dokumen Pengiriman"
        description="Upload file Excel dokumen pengiriman — otomatis masuk sebagai data permintaan."
        actions={
          <Button variant="outline" onClick={downloadTemplate}>
            <Download className="mr-1 h-4 w-4" /> Download Template
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-display text-base text-white">File Excel</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              onClick={() => fileRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-white/15 bg-white/[0.02] p-8 text-center transition hover:border-brand-400/40 hover:bg-white/[0.04]"
            >
              <FileSpreadsheet className="h-10 w-10 text-brand-300" />
              <p className="text-sm text-slate-300">
                {fileName || "Klik untuk pilih file .xlsx"}
              </p>
              <p className="text-xs text-slate-500">Format mengikuti template dokumen pengiriman</p>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                  e.target.value = "";
                }}
              />
            </div>

            {preview && (
              <div className="space-y-3 rounded-lg border border-white/10 p-4">
                {(sheetOptions.length > 1 || preview.sheetName) && (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-slate-400">Sheet diproses:</span>
                    {sheetOptions.length > 1 ? (
                      <select
                        value={preview.sheetName}
                        onChange={(e) => void changeSheet(e.target.value)}
                        className="rounded-md border border-white/15 bg-slate-900/70 px-2 py-1 text-xs text-slate-200"
                      >
                        {sheetOptions.map((sh) => (
                          <option key={sh.name} value={sh.name}>
                            {sh.name} — {sh.count} baris
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="font-medium text-slate-200">{preview.sheetName}</span>
                    )}
                    {sheetOptions.length > 1 && (
                      <span className="text-amber-200">
                        File punya {sheetOptions.length} sheet berisi data — sistem memakai sheet terbaru; ganti
                        lewat dropdown bila perlu.
                      </span>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-4 gap-3 text-center">
                  <div>
                    <p className="tnum font-display text-xl font-bold text-white">{preview.kept.length}</p>
                    <p className="text-xs text-slate-500">Baris diimpor</p>
                  </div>
                  <div>
                    <p className="tnum font-display text-xl font-bold text-white">{preview.groups}</p>
                    <p className="text-xs text-slate-500">Permintaan</p>
                  </div>
                  <div>
                    <p className="tnum font-display text-xl font-bold text-white">
                      {preview.lines.reduce((s, l) => s + l.qty, 0)}
                    </p>
                    <p className="text-xs text-slate-500">Total qty</p>
                  </div>
                  <div>
                    <p className={`tnum font-display text-xl font-bold ${preview.unmatched.length > 0 ? "text-amber-300" : "text-brand-300"}`}>
                      {preview.unmatched.length}
                    </p>
                    <p className="text-xs text-slate-500">Barang baru</p>
                  </div>
                </div>

                {/* Rincian qty per barang — dipakai untuk mengecek qty sudah sama dengan file */}
                <div className="max-h-72 overflow-auto rounded-md border border-white/10">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-slate-900/95 text-left text-slate-400">
                      <tr>
                        <th className="px-2 py-1.5 font-medium">Nama barang</th>
                        <th className="px-2 py-1.5 font-medium">Status aset</th>
                        <th className="px-2 py-1.5 font-medium">Terkirim</th>
                        <th className="px-2 py-1.5 text-right font-medium">Qty</th>
                        <th className="px-2 py-1.5 text-right font-medium">Baris</th>
                        <th className="px-2 py-1.5 font-medium">Catatan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.lines.map((l, i) => (
                        <tr key={`${l.itemKey}-${l.kodeKondisi}-${l.isPending}-${i}`} className="border-t border-white/5">
                          <td className="px-2 py-1.5 text-slate-200">
                            {nameOf(l)}
                            {!preview.idByName.has(l.itemName.toUpperCase()) && (
                              <span className="ml-1 text-amber-300">(baru)</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-slate-400">{asetLabelOf(l.kodeKondisi)}</td>
                          <td className="px-2 py-1.5 text-slate-400">{l.isPending ? "PENDING" : "TERKIRIM"}</td>
                          <td className="tnum px-2 py-1.5 text-right font-semibold text-white">{l.qty}</td>
                          <td className="tnum px-2 py-1.5 text-right text-slate-400">{l.rows.length}</td>
                          <td className="px-2 py-1.5 text-amber-200">
                            {l.qtyFile === 0
                              ? `QTY kosong di file → dihitung ${l.qty} dari ${l.rowCount} baris/barcode`
                              : l.qty > l.qtyFile
                                ? `QTY file ${l.qtyFile} untuk ${l.rowCount} baris → dipakai ${l.qty} unit${l.qtySource === "barcode" ? " (mengikuti jumlah barcode)" : ""}`
                                : l.qty < l.rowCount
                                  ? `QTY file ${l.qtyFile} dibagi ke ${l.rowCount} baris (blok di-merge)` 
                                  : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {preview.unmatched.length > 0 && (
                  <div className="flex gap-2 rounded-md bg-amber-400/10 p-3 text-xs text-amber-200">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <div>
                      {preview.unmatched.length} nama barang tidak ada di master:{" "}
                      {preview.unmatched.slice(0, 5).join(", ")}
                      {preview.unmatched.length > 5 && ` (+${preview.unmatched.length - 5} lainnya)`}.
                      {autoCreate ? " Akan dibuat otomatis." : " Aktifkan opsi buat-otomatis."}
                    </div>
                  </div>
                )}
                {preview.skipped.length > 0 && (
                  <div className="flex gap-2 rounded-md bg-amber-400/10 p-3 text-xs text-amber-200">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <div>
                      {preview.skipped.length} baris sudah ada di sistem (tiket + barang + barcode/resi sama)
                      → dilewati: baris {preview.skipped.slice(0, 8).map((r) => r.rowNo).join(", ")}
                      {preview.skipped.length > 8 && `, +${preview.skipped.length - 8} lainnya`}.
                    </div>
                  </div>
                )}
                {preview.lines.some((l) => l.qtyFile > 0 && l.qty > l.qtyFile) && (
                  <div className="flex gap-2 rounded-md bg-amber-400/10 p-3 text-xs text-amber-200">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <div>
                      Ada barang yang jumlah baris/barcode-nya lebih banyak dari angka QTY di file, jadi qty
                      dinaikkan (tiap baris/barcode = 1 unit fisik):{" "}
                      {preview.lines
                        .filter((l) => l.qtyFile > 0 && l.qty > l.qtyFile)
                        .slice(0, 4)
                        .map((l) => `${l.itemName} (QTY file ${l.qtyFile} → ${l.qty})`)
                        .join(", ")}
                      . Cek kembali file bila memang tidak sesuai.
                    </div>
                  </div>
                )}
                {preview.rows.some((r) => !r.ticket) && (
                  <div className="flex gap-2 rounded-md bg-amber-400/10 p-3 text-xs text-amber-200">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <div>
                      {preview.rows.filter((r) => !r.ticket).length} baris tidak punya NO TICKET (baris{" "}
                      {preview.rows.filter((r) => !r.ticket).slice(0, 8).map((r) => r.rowNo).join(", ")}
                      {preview.rows.filter((r) => !r.ticket).length > 8 ? ", …" : ""}) → akan dibuat jadi permintaan
                      terpisah per barang (nomor tiket otomatis). Isi NO TICKET di file bila ingin digabung.
                    </div>
                  </div>
                )}
                {preview.rows.some((r) => !r.dateExplicit) && (
                  <div className="flex gap-2 rounded-md bg-amber-400/10 p-3 text-xs text-amber-200">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <div>
                      {preview.rows.filter((r) => !r.dateExplicit).length} baris tanpa tanggal di file (baris{" "}
                      {preview.rows.filter((r) => !r.dateExplicit).slice(0, 8).map((r) => r.rowNo).join(", ")}
                      {preview.rows.filter((r) => !r.dateExplicit).length > 8 ? ", …" : ""}) — sistem memakai
                      tanggal hari ini untuk baris tersebut. Lengkapi kolom In Progress Date bila tanggalnya beda.
                    </div>
                  </div>
                )}
                {preview.rows.some((r) => r.qtyUnreadable) && (
                  <div className="flex gap-2 rounded-md bg-amber-400/10 p-3 text-xs text-amber-200">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <div>
                      Kolom QTY tidak terbaca sebagai angka di baris{" "}
                      {preview.rows.filter((r) => r.qtyUnreadable).slice(0, 8).map((r) => r.rowNo).join(", ")}
                      {" "}(dianggap {preview.rows.filter((r) => r.qtyUnreadable).length} baris tanpa qty). Perbaiki
                      isi kolom QTY di file bila perlu.
                    </div>
                  </div>
                )}
                {preview.dupsInFile.length > 0 && (
                  <div className="flex gap-2 rounded-md bg-amber-400/10 p-3 text-xs text-amber-200">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <div>
                      {preview.dupsInFile.length} baris punya tiket + barang + barcode/resi sama di dalam file
                      (baris {preview.dupsInFile.slice(0, 8).map((r) => r.rowNo).join(", ")}). Baris tetap
                      diproses — hapus di Excel bila memang dobel.
                    </div>
                  </div>
                )}
                {preview.existingTickets.length > 0 && (
                  <div className="flex gap-2 rounded-md bg-white/[0.03] p-3 text-xs text-slate-400">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <div>
                      Tiket {preview.existingTickets.slice(0, 5).join(", ")}
                      {preview.existingTickets.length > 5 && ` (+${preview.existingTickets.length - 5})`} sudah ada
                      di sistem. Baris yang identik dilewati; baris baru tetap dibuat sebagai permintaan baru.
                    </div>
                  </div>
                )}
              </div>
            )}

            {result && (
              <div className="space-y-3">
                <div className="flex gap-2 rounded-md bg-brand-400/10 p-3 text-sm text-brand-200">
                  <CheckCircle2 className="h-5 w-5 shrink-0" />
                  <p>{result}</p>
                </div>
                {failList.length > 0 && (
                  <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-3">
                    <p className="mb-2 text-sm font-semibold text-rose-200">
                      Rincian kegagalan ({failList.length}):
                    </p>
                    <ul className="max-h-64 space-y-1.5 overflow-y-auto text-sm text-rose-100/90">
                      {failList.map((f, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="shrink-0 font-mono font-semibold text-rose-300">{f.ticket}:</span>
                          <span>{f.detail}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-base text-white">Opsi Import</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={deductStock}
                onChange={(e) => setDeductStock(e.target.checked)}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-medium text-slate-200">Kurangi stok otomatis</span>
                <span className="block text-xs text-slate-500">
                  Buat transaksi barang keluar untuk tiap pengiriman. Matikan jika dokumen sudah lama dan stok sudah sesuai.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={autoCreate}
                onChange={(e) => setAutoCreate(e.target.checked)}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-medium text-slate-200">Buat barang baru otomatis</span>
                <span className="block text-xs text-slate-500">
                  Nama barang yang tidak cocok dengan master akan dibuatkan data barang baru.
                </span>
              </span>
            </label>
            <Button onClick={runImport} disabled={!preview || importing} className="w-full">
              <Upload className="mr-1 h-4 w-4" />
              {importing ? "Mengimpor…" : "Import ke Sistem"}
            </Button>
            {importing && progress && <p className="text-xs text-slate-500">{progress}</p>}
            <div className="text-xs text-slate-500">
              <Label className="mb-1 block">Cara pakai</Label>
              1. Download template, isi datanya.
              <br />
              2. Upload file yang sudah terisi (sheet terbaru otomatis dipakai).
              <br />
              3. Cek tabel pratinjau — pastikan QTY per barang sudah sama dengan file.
              <br />
              4. Klik Import.
            </div>
          </CardContent>
        </Card>
        <SheetSyncPanel />
        </div>
      </div>
    </div>
  );
}
