import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Download, Upload, FileSpreadsheet, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";

interface ParsedRow {
  date: string;
  ticket: string;
  branch: string;
  branchCode: string;
  itemName: string;
  qty: number;
  ket: string;
  resi: string;
  barcode: string;
  typeBarang: string;
  statusRequest: string;
  statusAset: string;
  terkirim: string;
}

interface Preview {
  rows: ParsedRow[];
  groups: number;
  unmatched: string[];
  dupTickets: string[];
}

const cleanNum = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  return String(v).trim();
};

const cleanStr = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  return String(v).trim();
};

const parseDate = (v: unknown): string => {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = cleanStr(v);
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return new Date().toISOString().slice(0, 10);
};

export function RequestUploadPage() {
  const { user, hasPermission } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [fileName, setFileName] = useState("");
  const [deductStock, setDeductStock] = useState(true);
  const [autoCreate, setAutoCreate] = useState(true);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<string | null>(null);

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
      const headers = ["In Progress Date","NO TICKET","CABANG/GERAI","KODE GERAI","NAMA BARANG","QTY",
        "KETERANGAN","RESI","BARCODE","TYPE BARANG","STATUS REQUEST","STATUS ASSET","STATUS TERKIRIM"];
      const example = ["2026-10-13","A2610130001","Jakarta Sortation","","KOMPUTER RAKITAN",3,
        "V3165SB380260700885","","A130025539","","","ASSET BARU","TERKIRIM"];
      XLSX.utils.book_append_sheet(wb,
        XLSX.utils.aoa_to_sheet([headers, example]), "PENGIRIMAN");
      const tips = [
        ["PETUNJUK PENGISIAN TEMPLATE DOKUMEN PENGIRIMAN"],
        [""],
        ["1. Isi data pada sheet PENGIRIMAN mulai baris 3 (baris 1 header, baris 2 contoh — contoh boleh dihapus)."],
        ["2. In Progress Date: tanggal pengiriman format YYYY-MM-DD."],
        ["3. NAMA BARANG: samakan dengan sheet DAFTAR BARANG (huruf besar/kecil bebas)."],
        ["4. QTY kosong + BARCODE terisi = dihitung 1."],
        ["5. STATUS TERKIRIM: TERKIRIM atau PENDING. Baris PENDING masuk dashboard Sisa Belum Terkirim."],
        ["6. Upload file terisi di menu ini (Upload Dokumen)."],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tips), "PETUNJUK");
      const daftar = [["KODE","NAMA BARANG (pakai nama ini di kolom NAMA BARANG)"],
        ...(((items ?? []) as { sku: string; name: string }[]).map((x) => [x.sku, x.name]))];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(daftar), "DAFTAR BARANG");
      XLSX.writeFile(wb, "Template_Upload_Pengiriman.xlsx");
    } catch (e) {
      toast.error("Gagal membuat template.");
    }
  };

  const handleFile = async (f: File) => {
    setPreview(null);
    setResult(null);
    setFileName(f.name);
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
      if (aoa.length < 2) {
        toast.error("File kosong atau tidak ada data.");
        return;
      }
      // Cari baris header (mengandung 'NAMA BARANG').
      let hIdx = aoa.findIndex((r: unknown[]) =>
        r.some((c: unknown) => cleanStr(c).toUpperCase() === "NAMA BARANG")
      );
      if (hIdx < 0) hIdx = 0;
      const headers = (aoa[hIdx] as unknown[]).map((c) => cleanStr(c).toUpperCase());
      const col = (name: string) => headers.indexOf(name);
      const cDate = col("IN PROGRESS DATE") >= 0 ? col("IN PROGRESS DATE") : col("TANGGAL");
      const cTicket = col("NO TICKET");
      const cBranch = col("CABANG/GERAI") >= 0 ? col("CABANG/GERAI") : col("GERAI");
      const cBranchCode = col("KODE GERAI");
      const cItem = col("NAMA BARANG");
      const cQty = col("QTY");
      const cKet = col("KETERANGAN");
      const cResi = col("RESI");
      const cBarcode = col("BARCODE");
      const cType = col("TYPE BARANG");
      const cStatusReq = col("STATUS REQUEST");
      const cStatusAset = col("STATUS ASSET");
      const cTerkirim = col("STATUS TERKIRIM");
      if (cItem < 0) {
        toast.error("Kolom NAMA BARANG tidak ditemukan. Pakai template yang disediakan.");
        return;
      }
      const rows: ParsedRow[] = [];
      for (let i = hIdx + 1; i < aoa.length; i++) {
        const r = aoa[i] as unknown[];
        const itemName = cleanStr(r[cItem]);
        if (!itemName || itemName.toUpperCase() === "NAMA BARANG") continue;
        let qty = Number(r[cQty]);
        if (!(qty > 0)) qty = 1;
        rows.push({
          date: cDate >= 0 ? parseDate(r[cDate]) : new Date().toISOString().slice(0, 10),
          ticket: cTicket >= 0 ? cleanStr(r[cTicket]) : "",
          branch: cBranch >= 0 ? cleanStr(r[cBranch]) || "TANPA GERAI" : "TANPA GERAI",
          branchCode: cBranchCode >= 0 ? cleanNum(r[cBranchCode]) : "",
          itemName,
          qty,
          ket: cKet >= 0 ? cleanStr(r[cKet]) : "",
          resi: cResi >= 0 ? cleanNum(r[cResi]) : "",
          barcode: cBarcode >= 0 ? cleanNum(r[cBarcode]) : "",
          typeBarang: cType >= 0 ? cleanStr(r[cType]) : "",
          statusRequest: cStatusReq >= 0 ? cleanStr(r[cStatusReq]) : "",
          statusAset: cStatusAset >= 0 ? cleanStr(r[cStatusAset]) : "",
          terkirim: cTerkirim >= 0 ? cleanStr(r[cTerkirim]).toUpperCase() : "",
        });
      }
      if (rows.length === 0) {
        toast.error("Tidak ada baris data valid.");
        return;
      }
      // Cocokkan nama barang.
      const { data: items, error: itemsErr } = await supabase
        .from("inventory_items")
        .select("id, name")
        .eq("is_active", true)
        .limit(5000);
      if (itemsErr) throw new Error(itemsErr.message);
      const nameSet = new Set(
        ((items ?? []) as { name: string }[]).map((x) => x.name.trim().toUpperCase())
      );
      const unmatched = [...new Set(rows.filter((r) => !nameSet.has(r.itemName.toUpperCase())).map((r) => r.itemName))];

      // Deteksi tiket duplikat (sudah ada di DB).
      const tickets = [...new Set(rows.map((r) => r.ticket).filter(Boolean))];
      let dupTickets: string[] = [];
      if (tickets.length > 0) {
        const { data: existing } = await supabase
          .from("requests")
          .select("ticket_no")
          .in("ticket_no", tickets.slice(0, 200));
        dupTickets = [...new Set(((existing ?? []) as { ticket_no: string }[]).map((x) => x.ticket_no))];
      }

      // Hitung grup.
      const groups = new Set(
        rows.map((r) =>
          r.ticket ? `${r.date}|${r.branch}|${r.ticket}` : `${r.date}|${r.branch}|ITEM:${r.itemName.toUpperCase()}`
        )
      );

      setPreview({ rows, groups: groups.size, unmatched, dupTickets });
      if (dupTickets.length > 0)
        toast.warning(`${dupTickets.length} no tiket sudah ada di sistem — akan dilewati.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal membaca file.");
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
      const rows = preview.rows;
      // 1) Match / buat barang.
      setProgress("Mencocokkan barang…");
      const { data: items } = await supabase
        .from("inventory_items")
        .select("id, name")
        .eq("is_active", true)
        .limit(5000);
      const byName = new Map<string, string>();
      for (const it of (items ?? []) as { id: string; name: string }[])
        byName.set(it.name.trim().toUpperCase(), it.id);

      if (autoCreate) {
        const missing = [...new Set(rows.map((r) => r.itemName).filter((n) => !byName.has(n.toUpperCase())))];
        // Ambil unit default (PCS) untuk barang baru.
        const { data: units } = await supabase.from("units").select("id, code").limit(50);
        const pcsUnit = ((units ?? []) as { id: string; code: string }[]).find((u) => u.code.toUpperCase() === "PCS")
          ?? (units?.[0] as { id: string } | undefined);
        if (!pcsUnit) throw new Error("Tabel satuan kosong — hubungi super admin.");
        for (let i = 0; i < missing.length; i += 50) {
          const batch = missing.slice(i, i + 50);
          // SKU unik per batch.
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
        throw new Error(`${preview.unmatched.length} nama barang tidak cocok dan opsi buat-otomatis mati.`);
      }

      // 2) Grouping.
      setProgress("Mengelompokkan data…");
      const groups = new Map<string, ParsedRow[]>();
      for (const r of rows) {
        const key = r.ticket ? `${r.date}|${r.branch}|${r.ticket}` : `${r.date}|${r.branch}|ITEM:${r.itemName.toUpperCase()}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(r);
      }

      // Skip tiket duplikat.
      const dupSet = new Set(preview.dupTickets);
      let defaultLocId: string | null = null;
      if (deductStock) {
        const { data: locs } = await supabase
          .from("locations")
          .select("id")
          .eq("is_active", true)
          .order("code")
          .limit(1);
        defaultLocId = (locs?.[0] as { id: string } | undefined)?.id ?? null;
        if (!defaultLocId) throw new Error("Tidak ada lokasi aktif untuk pengurangan stok.");
      }
      let reqCount = 0;
      let itemCount = 0;
      const failures: string[] = [];
      let n = 0;
      for (const [key, rs] of groups) {
        n++;
        const [date, branch, tkey] = key.split("|");
        const ticket = tkey.startsWith("ITEM:") ? null : tkey;
        if (ticket && dupSet.has(ticket)) continue;

        setProgress(`Mengimpor permintaan ${n}/${groups.size}…`);
        let reqId: string | null = null;
        try {
        const hasPending = rs.some((r) => r.terkirim === "PENDING");
        const { data: req, error: reqErr } = await supabase
          .from("requests")
          .insert({
            ticket_no: ticket ?? `UPL-${date}-${n}`,
            request_date: date,
            branch_name: branch,
            branch_code: rs[0].branchCode || null,
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

        // Agregasi per item (hindari duplikat unique constraint).
        const byItem = new Map<string, ParsedRow[]>();
        for (const r of rs) {
          const id = byName.get(r.itemName.toUpperCase());
          if (!id) throw new Error(`Barang tidak ditemukan: ${r.itemName}`);
          if (!byItem.has(id)) byItem.set(id, []);
          byItem.get(id)!.push(r);
        }
        const itemsPayload = [...byItem.entries()].map(([itemId, irs]) => ({
          request_id: req.id,
          item_id: itemId,
          qty_requested: irs.reduce((s, x) => s + x.qty, 0),
          qty_approved: irs.reduce((s, x) => s + x.qty, 0),
          barcode: [...new Set(irs.map((x) => x.barcode).filter(Boolean))].join("\n") || null,
          item_type: irs[0].typeBarang || null,
          status_aset: irs[0].statusAset || null,
          resi: [...new Set(irs.map((x) => x.resi).filter(Boolean))].join("\n") || null,
          item_status: "disetujui",
          notes: [...new Set(irs.map((x) => [x.ket && `Ket: ${x.ket}`, x.statusRequest && `Status request: ${x.statusRequest}`].filter(Boolean).join(" | ")).filter(Boolean))].join("\n") || null,
        }));
        const { data: inserted, error: itemsErr } = await supabase
          .from("request_items")
          .insert(itemsPayload)
          .select("id, qty_approved");
        if (itemsErr) throw new Error(itemsErr.message);
        reqCount++;
        itemCount += (inserted ?? []).length;

        // 3) Kurangi stok via RPC, atau tandai langsung.
        if (deductStock) {
          const lines = ((inserted ?? []) as { id: string; qty_approved: number | string }[]).map((x, idx) => ({
            request_item_id: x.id,
            qty: Number(x.qty_approved),
            resi: (itemsPayload[idx]?.resi ?? "").split("\n")[0] ?? "",
          }));
          const { error: shipErr } = await supabase.rpc("ship_request_items", {
            p_request_id: req.id,
            p_location_id: defaultLocId,
            p_lines: lines,
            p_notes: `Upload dokumen pengiriman ${ticket ?? ""}`.trim(),
          });
          if (shipErr) throw new Error(`Gagal kirim ${ticket ?? req.id}: ${shipErr.message}`);
        } else {
          // Tandai selesai tanpa ubah stok.
          const { data: cur } = await supabase.from("request_items").select("id, qty_approved").eq("request_id", req.id);
          for (const c of (cur ?? []) as { id: string; qty_approved: number | string }[]) {
            await supabase
              .from("request_items")
              .update({
                qty_shipped: Number(c.qty_approved),
                item_status: hasPending ? "pending_sebagian" : "terkirim",
              })
              .eq("id", c.id);
          }
          await supabase
            .from("requests")
            .update({ status: hasPending ? "disetujui_sebagian" : "selesai" })
            .eq("id", req.id);
        }
        } catch (e) {
          // Gagal di satu permintaan: hapus request yang sudah terbuat (rollback parsial), catat, lanjut.
          if (reqId) await supabase.from("requests").delete().eq("id", reqId);
          failures.push(`${ticket ?? `baris ${n}`}: ${e instanceof Error ? e.message : "gagal"}`);
        }
      }

      const failMsg = failures.length > 0
        ? ` Gagal ${failures.length}: ${failures.slice(0, 3).join("; ")}${failures.length > 3 ? "…" : ""}`
        : "";
      setResult(`Berhasil: ${reqCount} permintaan, ${itemCount} baris barang terimpor.${deductStock ? " Stok otomatis berkurang." : ""}${failMsg}`);
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
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="tnum font-display text-xl font-bold text-white">{preview.rows.length}</p>
                    <p className="text-xs text-slate-500">Baris data</p>
                  </div>
                  <div>
                    <p className="tnum font-display text-xl font-bold text-white">{preview.groups}</p>
                    <p className="text-xs text-slate-500">Permintaan</p>
                  </div>
                  <div>
                    <p className={`tnum font-display text-xl font-bold ${preview.unmatched.length > 0 ? "text-amber-300" : "text-brand-300"}`}>
                      {preview.unmatched.length}
                    </p>
                    <p className="text-xs text-slate-500">Barang baru</p>
                  </div>
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
                {preview.dupTickets.length > 0 && (
                  <div className="flex gap-2 rounded-md bg-rose-400/10 p-3 text-xs text-rose-200">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <div>
                      {preview.dupTickets.length} no tiket sudah ada dan akan dilewati:{" "}
                      {preview.dupTickets.slice(0, 5).join(", ")}
                      {preview.dupTickets.length > 5 && "…"}
                    </div>
                  </div>
                )}
              </div>
            )}

            {result && (
              <div className="flex gap-2 rounded-md bg-brand-400/10 p-3 text-sm text-brand-200">
                <CheckCircle2 className="h-5 w-5 shrink-0" />
                <p>{result}</p>
              </div>
            )}
          </CardContent>
        </Card>

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
              2. Upload file yang sudah terisi.
              <br />
              3. Periksa pratinjau, lalu klik Import.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
