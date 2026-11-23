import { useEffect, useMemo, useRef, useState } from "react";
import type { HTMLAttributes } from "react";
import * as XLSX from "xlsx";
import { Download, Upload, FileSpreadsheet, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { generateSkus } from "../lib/sku";
import { cn } from "../lib/utils";
import { formatDate } from "../lib/format";
import { SheetSyncPanel } from "../features/sync/SheetSyncPanel";
import {
  compareUploadWithSheet,
  sheetDiffCount,
  type SheetDiff,
} from "../lib/compareSheet";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { CardContent, CardHeader, CardTitle } from "../components/ui/card";
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
  applySheetDate,
  matchPendingForLine,
  normalizeItemName,
  pickMergeTarget,
  type ExistingRequestRef,
  type AggLine,
  type DupIndex,
  type FulfillmentPlan,
  type KodeKondisi,
  type LineFulfillmentPlan,
  type ParsedShippingRow,
  type PendingItem,
  type SheetCandidate,
  type StoredItemRow,
} from "../lib/shippingUpload";

// Ubah pesan error teknis (berisi UUID) menjadi bahasa yang mudah dipahami.
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
  /** Barang pending (Sisa Belum Terkirim) yang akan otomatis terkirim oleh file ini. */
  fulfillments: FulfillmentPlan[];
  idByName: Map<string, string>;
  nameById: Map<string, string>;
  /** Sheet yang sedang dipratinjau (nama sheet di file Excel). */
  sheetName: string;
  /** Semua sheet yang bisa dipilih dari file yang di-upload. */
  sheetOptions: { name: string; count: number }[];
  groups: number;
  /** Grup yang akan digabung ke tiket yang sudah ada (bukan permintaan baru). */
  mergeGroups: number;
  /** Rentang tanggal pengiriman di file (tanggal yang akan dipakai upload). */
  dateRange: { min: string; max: string } | null;
  unmatched: string[];
  existingTickets: string[];
}

/** Barang yang stoknya akan minus kalau file ini diimpor (potong stok aktif). */
interface MinusWarning {
  itemName: string;
  kondisi: KodeKondisi;
  stockNow: number;
  qtyOut: number;
  /** Sisa stok setelah dipotong — selalu negatif di daftar ini. */
  projected: number;
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

/** Pecah sel barcode/resi yang menyimpan beberapa nilai (dipisah baris baru). */
const splitStoredCodes = (v: string | null | undefined): string[] =>
  (v ?? "").split("\n").map((s) => s.trim()).filter(Boolean);

/**
 * Ambil baris pending (Sisa Belum Terkirim) untuk tiket-tiket di file —
 * tanpa filter tanggal, karena pending bisa berasal dari file tanggal lama.
 * Dipakai pratinjau (rencana pelunasan) dan import (pelunasan beneran).
 */
async function loadPendingForTickets(tickets: string[]): Promise<PendingItem[]> {
  if (tickets.length === 0) return [];
  const out: PendingItem[] = [];
  for (const tBatch of batches(tickets, 60)) {
    const { data: reqs, error } = await supabase
      .from("requests")
      .select("id, ticket_no, branch_name, request_date")
      .in("ticket_no", tBatch)
      .limit(3000);
    if (error) throw new Error(error.message);
    const reqs2 = (reqs ?? []) as { id: string; ticket_no: string; branch_name: string; request_date: string }[];
    if (reqs2.length === 0) continue;
    const reqById = new Map(reqs2.map((r) => [r.id, r]));
    for (const idBatch of batches([...reqById.keys()], 80)) {
      const { data: items, error: itErr } = await supabase
        .from("request_items")
        .select("id, request_id, item_id, status_aset, qty_requested, qty_approved, qty_shipped, item_status, barcode, resi, created_at")
        .in("request_id", idBatch)
        .in("item_status", ["pending_sebagian", "menunggu_stok"])
        .order("created_at", { ascending: true })
        .limit(5000);
      if (itErr) throw new Error(itErr.message);
      for (const it of (items ?? []) as {
        id: string; request_id: string; item_id: string; status_aset: string | null;
        qty_requested: number | string; qty_approved: number | string | null;
        qty_shipped: number | string; item_status: string; barcode: string | null;
        resi: string | null; created_at: string;
      }[]) {
        const req = reqById.get(it.request_id);
        if (!req) continue;
        out.push({
          id: it.id, request_id: it.request_id, request_date: req.request_date,
          ticket_no: req.ticket_no, branch_name: req.branch_name, item_id: it.item_id,
          status_aset: it.status_aset, qty_requested: it.qty_requested,
          qty_approved: it.qty_approved, qty_shipped: it.qty_shipped,
          item_status: it.item_status, barcode: it.barcode, resi: it.resi,
          created_at: it.created_at,
        });
      }
    }
  }
  return out;
}

/**
 * Rencana pelunasan pending untuk satu grup (satu tiket): tiap line TERKIRIM
 * dicocokkan ke baris pending tiket itu. Dipakai pratinjau dan import supaya
 * rencananya sama persis dengan yang dieksekusi.
 */
function planGroupFulfillments(
  groupRows: ParsedShippingRow[],
  keyOf: (r: ParsedShippingRow) => string,
  pendingForTicket: PendingItem[],
): FulfillmentPlan[] {
  if (groupRows.length === 0 || pendingForTicket.length === 0) return [];
  const lines = aggregateGroup(groupRows, keyOf);
  const plans: FulfillmentPlan[] = [];
  for (const line of lines) {
    if (line.isPending || line.itemKey.startsWith("NAME:")) continue;
    const plan = matchPendingForLine(line, pendingForTicket);
    const fulfillQty = plan.used.reduce((s, u) => s + u.fulfillQty, 0);
    if (fulfillQty <= 0) continue;
    plans.push({
      ticket: groupRows[0].ticket,
      branch: groupRows[0].branch,
      itemName: line.itemName,
      kodeKondisi: line.kodeKondisi,
      fulfillQty,
      excessQty: plan.excessQty,
      pendingSisaAfter: plan.pendingRemainingAfter,
      needsApprove: plan.used.some((u) => u.needsApprove),
    });
  }
  return plans;
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
  /** Peringatan stok minus untuk pratinjau saat ini (null = belum dicek / tidak berlaku). */
  const [minusWarnings, setMinusWarnings] = useState<MinusWarning[] | null>(null);
  const [minusLoading, setMinusLoading] = useState(false);
  /**
   * Perbandingan file dengan Google Sheet (dokumen pengiriman) — pengingat
   * saja, BUKAN penghalang: upload tetap bisa lanjut walau ada beda.
   * null = belum dicek / tidak ada pratinjau.
   */
  const [sheetDiff, setSheetDiff] = useState<SheetDiff | null>(null);
  const [sheetDiffLoading, setSheetDiffLoading] = useState(false);
  const [sheetDiffError, setSheetDiffError] = useState<string | null>(null);
  const [sheetOptions, setSheetOptions] = useState<{ name: string; count: number }[]>([]);
  const sheetCache = useRef<Map<string, SheetCandidate>>(new Map());

  const canShip = hasPermission("requests.review");

  // Rincian qty pratinjau: berapa yang akan terkirim (stok berkurang) dan
  // berapa yang PENDING (masuk Sisa Belum Terkirim, stok tidak berkurang).
  const qtyBreakdown = useMemo(() => {
    if (!preview) return null;
    let terkirim = 0;
    let pending = 0;
    const perKondisi = new Map<string, number>();
    for (const l of preview.lines) {
      if (l.isPending) {
        pending += l.qty;
      } else {
        terkirim += l.qty;
        perKondisi.set(l.kodeKondisi, (perKondisi.get(l.kodeKondisi) ?? 0) + l.qty);
      }
    }
    return {
      total: terkirim + pending,
      terkirim,
      pending,
      perKondisi: [...perKondisi.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [preview]);

  // Cek stok minus: bandingkan qty keluar di pratinjau dengan stok saat ini per
  // barang + lokasi. Hanya jalan saat opsi "Kurangi stok otomatis" aktif — kalau
  // mati, impor tidak mengubah stok jadi tidak ada yang bisa minus.
  useEffect(() => {
    let cancelled = false;
    if (!preview || !deductStock) {
      setMinusWarnings(null);
      setMinusLoading(false);
      return;
    }
    setMinusLoading(true);
    void (async () => {
      try {
        // Agregasi qty keluar per barang + kondisi (hanya baris TERKIRIM yang motong stok).
        const out = new Map<string, { itemName: string; kondisi: KodeKondisi; qty: number }>();
        for (const l of preview.lines) {
          if (l.isPending) continue;
          if (l.itemKey.startsWith("NAME:")) continue; // barang baru — sudah diperingatkan di kotak lain
          const key = `${l.itemKey}|${l.kodeKondisi}`;
          const cur = out.get(key) ?? { itemName: l.itemName, kondisi: l.kodeKondisi, qty: 0 };
          cur.qty += l.qty;
          out.set(key, cur);
        }
        if (out.size === 0) {
          if (!cancelled) {
            setMinusWarnings([]);
            setMinusLoading(false);
          }
          return;
        }
        const { data: locs } = await supabase
          .from("locations")
          .select("id, code")
          .in("code", ["STOK-BARU", "STOK-RETUR", "STOK-UNREADY"]);
        const locByKode = new Map(
          ((locs ?? []) as { id: string; code: string }[]).map((l) => [l.code, l.id])
        );
        const locIds = [...locByKode.values()];
        if (locIds.length === 0) {
          if (!cancelled) {
            setMinusWarnings([]);
            setMinusLoading(false);
          }
          return;
        }
        const itemIds = [...new Set([...out.keys()].map((k) => k.split("|")[0]))];
        const { data: bals } = await supabase
          .from("inventory_balances")
          .select("item_id, location_id, qty")
          .in("item_id", itemIds)
          .in("location_id", locIds)
          .limit(5000);
        const stockMap = new Map<string, number>();
        for (const b of (bals ?? []) as { item_id: string; location_id: string; qty: number | string }[]) {
          stockMap.set(`${b.item_id}|${b.location_id}`, Number(b.qty) || 0);
        }
        const warnings: MinusWarning[] = [];
        for (const [key, v] of out) {
          const [itemId, kode] = key.split("|");
          const locId = locByKode.get(kode);
          if (!locId) continue;
          const now = stockMap.get(`${itemId}|${locId}`) ?? 0;
          const projected = now - v.qty;
          if (projected < 0) {
            warnings.push({
              itemName: v.itemName,
              kondisi: kode as KodeKondisi,
              stockNow: now,
              qtyOut: v.qty,
              projected,
            });
          }
        }
        warnings.sort((a, b) => a.projected - b.projected);
        if (!cancelled) {
          setMinusWarnings(warnings);
          setMinusLoading(false);
        }
      } catch {
        if (!cancelled) {
          setMinusWarnings(null);
          setMinusLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [preview, deductStock]);

  // Cek dengan Google Sheet (dokumen pengiriman): bandingkan baris file dengan
  // baris Sheet untuk tanggal yang sama. PENGINGAT SAJA — hasilnya tidak
  // memblokir upload; bila Sheet tidak bisa dibaca, upload tetap jalan.
  useEffect(() => {
    let cancelled = false;
    if (!preview) {
      setSheetDiff(null);
      setSheetDiffError(null);
      setSheetDiffLoading(false);
      return;
    }
    const dates = [...new Set(preview.rows.map((r) => r.date))].sort();
    if (dates.length === 0) {
      setSheetDiff(null);
      setSheetDiffError(null);
      setSheetDiffLoading(false);
      return;
    }
    setSheetDiffLoading(true);
    setSheetDiffError(null);
    setSheetDiff(null);
    void (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("sync-sheets", {
          body: { action: "rows", dates },
        });
        if (cancelled) return;
        if (error) throw new Error(error.message);
        // Fungsi lama (belum di-deploy ulang) tidak mengenal "rows" dan akan
        // menjawab hasil sinkronisasi — jangan tampilkan itu sebagai perbandingan.
        const sheets = (data as { sheets?: { rows?: ParsedShippingRow[] }[] } | null)?.sheets;
        if (!Array.isArray(sheets)) {
          throw new Error("Fungsi sinkronisasi di server belum diperbarui — perbandingan tidak tersedia.");
        }
        const sheetRows: ParsedShippingRow[] = [];
        for (const sh of sheets) {
          for (const r of sh.rows ?? []) {
            // Hanya baris yang tanggalnya sama dengan tanggal di file.
            if (dates.includes(r.date)) sheetRows.push(r);
          }
        }
        if (sheetRows.length === 0) {
          throw new Error("Google Sheet tidak punya baris untuk tanggal di file ini.");
        }
        if (!cancelled) setSheetDiff(compareUploadWithSheet(preview.rows, sheetRows));
      } catch (e) {
        if (cancelled) return;
        setSheetDiffError(e instanceof Error ? e.message : "Gagal membandingkan dengan Google Sheet.");
      } finally {
        if (!cancelled) setSheetDiffLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [preview]);

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
        ["3. NAMA BARANG: samakan dengan sheet DAFTAR BARANG (huruf besar/kecil, spasi, dan underscore bebas — sistem mencocokkan nama secara toleran)."],
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
            .select("request_id, item_id, barcode, resi, qty_requested, item_status")
            .in("request_id", idBatch)
            .limit(5000);
          if (itErr) throw new Error(itErr.message);
          for (const it of (items ?? []) as {
            request_id: string;
            item_id: string;
            barcode: string | null;
            resi: string | null;
            qty_requested: number | string;
            item_status: string | null;
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
              // Status ikut dibaca supaya filter duplikat tahu baris pending:
              // baris TERKIRIM yang cocok dengan pending BUKAN duplikat,
              // melainkan pelunasan pending itu.
              item_status: it.item_status,
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
  const buildPreview = async (rowsIn: ParsedShippingRow[], sheetName: string) => {
    // Baris tanpa tanggal memakai tanggal sheet (bukan tanggal hari ini) supaya tidak dobel
    // saat file yang sama diproses ulang di hari lain.
    const rows = applySheetDate(rowsIn, sheetName);
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
        idByName.set(normalizeItemName(it.name), it.id);
        nameById.set(it.id, it.name);
      }
      const keyOf = (r: ParsedShippingRow): string =>
        idByName.get(normalizeItemName(r.itemName)) ?? `NAME:${normalizeItemName(r.itemName)}`;
      const unmatched = [
        ...new Set(rows.filter((r) => !idByName.has(normalizeItemName(r.itemName))).map((r) => r.itemName)),
      ];

      // Baris yang sudah pernah masuk (upload ulang file yang sama) dibuang.
      const { index, existingTickets } = await loadExisting(rows);
      const { kept, skipped } = filterDuplicateRows(rows, keyOf, index);
      const dupsInFile = findDuplicateRowsInFile(kept, keyOf);
      const lines = aggregateGroup(kept, keyOf);
      const groups = new Set(kept.map(groupKeyOf));

      // Barang pending (Sisa Belum Terkirim) yang akan otomatis terkirim karena
      // file ini berisi tiket + barang yang sama dengan status TERKIRIM.
      // Dihitung per grup (satu tiket) supaya cocok dengan yang dieksekusi import.
      let fulfillments: FulfillmentPlan[] = [];
      const pendingAll = await loadPendingForTickets([...new Set(kept.map((r) => r.ticket).filter(Boolean))]);
      if (pendingAll.length > 0) {
        const byGroup = new Map<string, ParsedShippingRow[]>();
        for (const r of kept) {
          const k = groupKeyOf(r);
          if (!byGroup.has(k)) byGroup.set(k, []);
          byGroup.get(k)!.push(r);
        }
        for (const rs of byGroup.values()) {
          const first = rs[0];
          const pend = pendingAll.filter(
            (p) =>
              p.ticket_no.trim().toUpperCase() === first.ticket.trim().toUpperCase() &&
              p.branch_name.trim().toUpperCase() === first.branch.trim().toUpperCase(),
          );
          if (pend.length === 0) continue;
          fulfillments.push(...planGroupFulfillments(rs, keyOf, pend));
        }
      }

      // Tiket yang sudah ada: grup-grup ini akan digabung (bukan permintaan baru).
      const mergeTickets = [...new Set(kept.map((r) => r.ticket).filter(Boolean))];
      let mergeGroups = 0;
      if (mergeTickets.length > 0) {
        const { data: mergeReqs } = await supabase
          .from("requests")
          .select("id, ticket_no, branch_name, request_date, created_at")
          .in("ticket_no", mergeTickets)
          .order("created_at", { ascending: false })
          .limit(1000);
        const candidates = (mergeReqs ?? []) as ExistingRequestRef[];
        for (const gk of groups) {
          const parts = gk.split("|");
          if (parts.length !== 3 || parts[2].startsWith("ITEM:")) continue;
          if (pickMergeTarget(candidates, parts[2], parts[1])) mergeGroups++;
        }
      }

      // Rentang tanggal pengiriman di file — tanggal inilah yang dipakai upload.
      const dates = kept.map((r) => r.date).sort();
      const dateRange = dates.length > 0 ? { min: dates[0], max: dates[dates.length - 1] } : null;

    setPreview({
      rows,
      kept,
      skipped,
      dupsInFile,
      lines,
      fulfillments,
      idByName,
      nameById,
      sheetName,
      sheetOptions: [...sheetCache.current.entries()].map(([name, c]) => ({ name, count: c.rows.length })),
      groups: groups.size,
      mergeGroups,
      dateRange,
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
        byName.set(normalizeItemName(it.name), it.id);
        itemNameById.set(it.id, it.name);
      }

      if (autoCreate) {
        const missing = [...new Set(preview.rows.map((r) => r.itemName).filter((n) => !byName.has(normalizeItemName(n))))];
        const { data: units } = await supabase.from("units").select("id, code").limit(50);
        const pcsUnit = ((units ?? []) as { id: string; code: string }[]).find((u) => u.code.toUpperCase() === "PCS")
          ?? (units?.[0] as { id: string } | undefined);
        if (!pcsUnit) throw new Error("Tabel satuan kosong — hubungi super admin.");
        // SKU otomatis skema keluarga XXX-NNN, dihitung sekali untuk semua
        // barang baru supaya nomornya berurutan dan tidak bentrok di batch.
        const newSkus = await generateSkus(supabase, missing);
        const skuByName = new Map(missing.map((n, idx) => [n, newSkus[idx]]));
        for (let i = 0; i < missing.length; i += 50) {
          const batch = missing.slice(i, i + 50);
          const withSku = batch.map((n) => ({
            sku: skuByName.get(n) ?? `UPL-${Date.now().toString(36).toUpperCase()}`,
            name: n,
            unit_id: pcsUnit.id,
            is_active: true,
          }));
          const { data: created, error } = await supabase.from("inventory_items").insert(withSku).select("id, name");
          if (error) throw new Error(`Gagal membuat barang: ${error.message}`);
          for (const c of (created ?? []) as { id: string; name: string }[])
            byName.set(normalizeItemName(c.name), c.id);
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
      const keyOf = (r: ParsedShippingRow): string => byName.get(normalizeItemName(r.itemName)) ?? "";
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
      let mergedCount = 0;
      let itemCount = 0;
      let totalQty = 0;
      let fulfilledRows = 0;
      let fulfilledQty = 0;
      const failures: { ticket: string; detail: string }[] = [];
      let n = 0;
      for (const rs of groups.values()) {
        n++;
        const first = rs[0];
        const ticket = first.ticket || null;
        setProgress(`Mengimpor permintaan ${n}/${groups.size}…`);
        let reqId: string | null = null;
        let merged = false;
        let insertedItemIds: string[] = [];
        // Pelunasan pending di grup ini (dihitung sebelum eksekusi supaya
        // pesan gagal tetap bisa menyebutnya).
        let groupFulfilledRows = 0;
        let groupFulfilledQty = 0;
        try {
          // Baris per barang + kondisi aset + status terkirim.
          const lines = aggregateGroup(rs, (r) => {
            const id = byName.get(normalizeItemName(r.itemName));
            if (!id) throw new Error(`Barang tidak ditemukan: ${r.itemName}`);
            return id;
          });
          const hasPending = lines.some((l) => l.isPending);

          // Gabung ke permintaan yang sudah ada (tiket + gerai sama) — jangan
          // bikin permintaan baru untuk tiket yang sama.
          if (ticket) {
            const { data: found, error: findErr } = await supabase
              .from("requests")
              .select("id, ticket_no, branch_name, request_date, created_at")
              .eq("ticket_no", ticket)
              .order("created_at", { ascending: false })
              .limit(50);
            if (findErr) throw new Error(findErr.message);
            const target = pickMergeTarget((found ?? []) as ExistingRequestRef[], ticket, first.branch);
            if (target) {
              reqId = target.id;
              merged = true;
              // Tanggal permintaan ikut tanggal pengiriman batch ini supaya
              // transaksi keluar stok yang baru tercatat di tanggal file
              // (bukan tanggal batch lama). Transaksi lama tidak berubah.
              if (target.request_date !== first.date) {
                const { error: dateErr } = await supabase
                  .from("requests")
                  .update({ request_date: first.date })
                  .eq("id", reqId);
                if (dateErr) throw new Error(dateErr.message);
              }
            }
          }

          if (!merged) {
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
          }
          if (!reqId) throw new Error("Permintaan tidak terbentuk.");

          // Pelunasan pending: bila tiket ini sudah punya baris pending
          // (Sisa Belum Terkirim) untuk barang + kondisi yang sama, line
          // TERKIRIM di file melunasi baris itu — bukan bikin baris baru.
          // Hanya berlaku bila gabung ke tiket lama (permintaan baru tidak
          // punya pending). Dihitung ulang di sini (bukan dari pratinjau)
          // supaya data yang dipakai adalah kondisi terbaru di database.
          const pendingById = new Map<string, PendingItem>();
          const linePlans = new Map<AggLine, LineFulfillmentPlan>();
          if (merged && ticket) {
            const pendingAll = await loadPendingForTickets([ticket]);
            const pend = pendingAll.filter(
              (p) => p.branch_name.trim().toUpperCase() === first.branch.trim().toUpperCase(),
            );
            for (const p of pend) pendingById.set(p.id, p);
            for (const line of lines) {
              if (line.isPending) continue;
              const plan = matchPendingForLine(line, pend);
              if (plan.used.length > 0) linePlans.set(line, plan);
            }
          }

          // Baris yang benar-benar dimasukkan: line PENDING utuh; line
          // TERKIRIM yang melunasi pending hanya menyisakan kelebihannya
          // (bila qty file lebih besar dari sisa pending) sebagai baris baru.
          type InsertJob = { line: AggLine; id: string; qty: number; isExcess: boolean };
          const insertJobs: InsertJob[] = [];
          for (const line of lines) {
            const plan = linePlans.get(line);
            if (!line.isPending && plan && plan.used.length > 0) {
              if (plan.excessQty > 0)
                insertJobs.push({ line, id: uuid(), qty: plan.excessQty, isExcess: true });
            } else {
              insertJobs.push({ line, id: uuid(), qty: line.qty, isExcess: false });
            }
          }
          // Id baris dibuat di sisi klien supaya pemetaan hasil insert -> baris import
          // tidak bergantung pada urutan balikan PostgREST.
          insertedItemIds = insertJobs.map(({ id }) => id);
          const baseNotes = (line: AggLine): string | null =>
            [...new Set(line.rows.map((x) =>
              [x.ket && `Ket: ${x.ket}`, x.statusRequest && `Status request: ${x.statusRequest}`]
                .filter(Boolean).join(" | ")
            ).filter(Boolean))].join("\n") || null;
          const payload = insertJobs.map(({ line, id, qty, isExcess }) => {
            const notes = baseNotes(line);
            return {
              id,
              request_id: reqId,
              item_id: line.itemKey,
              qty_requested: qty,
              qty_approved: qty,
              qty_shipped: 0,
              // Barcode file ikut ke baris pending yang dilunasi (digabung di
              // bawah), jadi baris kelebihan tidak membawa barcode lagi —
              // kalau ikut dibawa, barcode yang sama tercatat dua kali.
              barcode: isExcess ? null : [...new Set(line.rows.map((x) => x.barcode).filter(Boolean))].join("\n") || null,
              item_type: line.rows[0].typeBarang || null,
              status_aset: line.rows[0].statusAset || null,
              resi: [...new Set(line.rows.map((x) => x.resi).filter(Boolean))].join("\n") || null,
              item_status: line.isPending ? "pending_sebagian" : "disetujui",
              notes: isExcess
                ? [notes, "Kelebihan qty dari pelunasan pending (bagian pending sudah dilunasi)."].filter(Boolean).join("\n")
                : notes,
            };
          });
          if (payload.length > 0) {
            const { error: itemsErr } = await supabase.from("request_items").insert(payload);
            if (itemsErr) throw new Error(itemsErr.message);
          }
          if (merged) mergedCount++;
          else reqCount++;
          itemCount += payload.length;
          totalQty += lines.reduce((s, l) => s + l.qty, 0);

          // Daftar kirim per (permintaan, kondisi) — pelunasan bisa menarget
          // permintaan lama lain dengan tiket yang sama (tiket terpecah).
          type ShipLine = { request_item_id: string; qty: number; resi: string };
          const shipGroups = new Map<string, { requestId: string; kode: KodeKondisi; lines: ShipLine[] }>();
          const addShip = (requestId: string, kode: KodeKondisi, shipLine: ShipLine) => {
            const key = `${requestId}|${kode}`;
            const g = shipGroups.get(key) ?? { requestId, kode, lines: [] };
            g.lines.push(shipLine);
            shipGroups.set(key, g);
          };

          // Lunasi baris pending yang cocok. Baris pending BUKAN dihapus bila
          // grup ini gagal sesudahnya — barangnya memang sudah dikirim, dan
          // RPC di bawah memvalidasi qty terhadap sisa (tidak bisa dobel).
          for (const [line, plan] of linePlans) {
            const lineResi = line.rows.map((x) => x.resi).find(Boolean) ?? "";
            const lineBarcodes = [...new Set(line.rows.map((x) => x.barcode).filter(Boolean))];
            for (const u of plan.used) {
              const pend = pendingById.get(u.pendingId);
              if (!pend) continue;
              // Gabung barcode file ke baris pending supaya unit yang dikirim terlacak.
              const mergedBarcode =
                [...new Set([...splitStoredCodes(pend.barcode), ...lineBarcodes])].join("\n") || null;
              const patch: Record<string, unknown> = {};
              if (mergedBarcode !== (pend.barcode ?? null)) patch.barcode = mergedBarcode;
              if (u.needsApprove) {
                patch.item_status = "pending_sebagian";
                if (pend.qty_approved == null) patch.qty_approved = pend.qty_requested;
              }
              if (!deductStock) {
                patch.qty_shipped = (Number(pend.qty_shipped ?? 0) || 0) + u.fulfillQty;
                patch.item_status = u.pendingSisaAfter <= 0 ? "terkirim" : "pending_sebagian";
                if (lineResi) patch.resi = lineResi;
              }
              if (Object.keys(patch).length > 0) {
                const { error: updErr } = await supabase.from("request_items").update(patch).eq("id", pend.id);
                if (updErr) throw new Error(updErr.message);
              }
              // Tanggal permintaan pemilik pending ikut tanggal file (aturan
              // yang sama seperti penggabungan tiket) supaya transaksi keluar
              // tercatat di tanggal pengiriman file, bukan tanggal batch lama.
              if (pend.request_id !== reqId && pend.request_date !== first.date) {
                const { error: dateErr } = await supabase
                  .from("requests")
                  .update({ request_date: first.date })
                  .eq("id", pend.request_id);
                if (dateErr) throw new Error(dateErr.message);
              }
              if (deductStock) {
                addShip(pend.request_id, line.kodeKondisi, {
                  request_item_id: pend.id,
                  qty: u.fulfillQty,
                  resi: lineResi,
                });
              }
              groupFulfilledRows++;
              groupFulfilledQty += u.fulfillQty;
            }
          }

          if (deductStock) {
            // Kelompokkan item TERKIRIM (bukan PENDING) per kondisi:
            // RETUR/RETURN → STOK-RETUR, UNREADY → STOK-UNREADY, lainnya → STOK-BARU.
            for (const { line, id, qty } of insertJobs) {
              if (line.isPending) continue;
              addShip(reqId, line.kodeKondisi, {
                request_item_id: id,
                qty,
                resi: line.rows.map((x) => x.resi).find(Boolean) ?? "",
              });
            }
            for (const g of shipGroups.values()) {
              const locId = locByKondisi.get(g.kode);
              if (!locId) throw new Error(`Lokasi ${g.kode} belum ada di database.`);
              const { error: shipErr } = await supabase.rpc("ship_request_items", {
                p_request_id: g.requestId,
                p_location_id: locId,
                p_lines: g.lines,
                p_notes: `Upload dokumen pengiriman ${ticket ?? ""} (${g.kode})`.trim(),
                p_allow_negative: true,
              });
              if (shipErr) throw new Error(`Gagal kirim ${ticket ?? g.requestId} [${g.kode}]: ${shipErr.message}`);
            }
            if (hasPending) {
              await supabase
                .from("requests")
                .update({ status: "disetujui_sebagian" })
                .eq("id", reqId);
            }
          } else {
            // Tandai selesai/pending tanpa ubah stok. Status dihitung dari
            // SELURUH barang permintaan (bukan hanya batch ini) supaya
            // permintaan gabungan tidak salah jadi "selesai" padahal masih
            // ada barang pending dari batch lama. Permintaan pemilik pending
            // yang dilunasi ikut dihitung ulang statusnya.
            for (const { line, id, qty } of insertJobs) {
              await supabase
                .from("request_items")
                .update({
                  qty_shipped: line.isPending ? 0 : qty,
                  item_status: line.isPending ? "pending_sebagian" : "terkirim",
                })
                .eq("id", id);
            }
            const affected = new Set<string>([reqId]);
            for (const plan of linePlans.values())
              for (const u of plan.used) affected.add(u.pendingRequestId);
            for (const rid of affected) {
              const { data: allItems } = await supabase
                .from("request_items")
                .select("item_status")
                .eq("request_id", rid);
              const anyPending = (allItems ?? []).some(
                (it) => it.item_status === "pending_sebagian" || it.item_status === "menunggu_stok",
              );
              await supabase
                .from("requests")
                .update({ status: anyPending ? "disetujui_sebagian" : "selesai" })
                .eq("id", rid);
            }
          }
          fulfilledRows += groupFulfilledRows;
          fulfilledQty += groupFulfilledQty;
        } catch (e) {
          // Gagal di satu permintaan: permintaan BARU yang sudah terbuat
          // dihapus (rollback parsial); kalau gabung, hanya baris baru yang
          // dihapus — permintaan lama beserta isinya tidak boleh hilang.
          // Baris pending yang sudah dilunasi TIDAK dihapus: barangnya memang
          // sudah dikirim (transaksi OUT-nya sudah tercatat).
          if (!merged && reqId) await supabase.from("requests").delete().eq("id", reqId);
          if (merged && insertedItemIds.length > 0)
            await supabase.from("request_items").delete().in("id", insertedItemIds);
          const rawMsg = e instanceof Error ? e.message : "gagal";
          const fulfilledNote =
            groupFulfilledQty > 0
              ? ` (Catatan: ${groupFulfilledRows} barang pending sudah sempat terkirim ${groupFulfilledQty} unit sebelum gagal — tidak dibatalkan karena barangnya memang sudah dikirim.)`
              : "";
          failures.push({
            ticket: ticket ?? `baris grup ${n}`,
            detail: formatShipError(rawMsg, itemNameById) + fulfilledNote,
          });
        }
      }

      setFailList(failures);
      const failMsg = failures.length > 0 ? ` Gagal: ${failures.length} permintaan (lihat rincian di bawah).` : "";
      const dupMsg = skippedDup > 0 ? ` ${skippedDup} baris duplikat dilewati.` : "";
      const fulfilledMsg = fulfilledRows > 0 ? ` ${fulfilledRows} barang pending otomatis terkirim (${fulfilledQty} unit).` : "";
      const emptyMsg = filteredRows.length === 0 ? " Tidak ada baris baru untuk diimpor." : "";
      setResult(
        `Berhasil: ${reqCount} permintaan baru${mergedCount > 0 ? `, ${mergedCount} permintaan digabung ke tiket yang sudah ada` : ""}, ${itemCount} baris barang (total qty ${totalQty}).${fulfilledMsg}${deductStock ? " Stok otomatis berkurang." : ""}${dupMsg}${emptyMsg}${failMsg}`
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
          <Button variant="outline" className={DARK_OUTLINE_BTN} onClick={downloadTemplate}>
            <Download className="mr-1 h-4 w-4" /> Download Template
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <GlassCard className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-display text-base text-white">File Excel</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              onClick={() => fileRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-white/20 bg-white/5 p-8 text-center transition hover:border-white/30 hover:bg-white/10"
            >
              <FileSpreadsheet className="h-10 w-10 text-brand-200" />
              <p className="text-sm text-white">
                {fileName || "Klik untuk pilih file .xlsx"}
              </p>
              <p className="text-xs text-ink-300">Format mengikuti template dokumen pengiriman</p>
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
              <div className="space-y-3 rounded-lg border border-white/15 p-4">
                {(sheetOptions.length > 1 || preview.sheetName) && (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-ink-300">Sheet diproses:</span>
                    {sheetOptions.length > 1 ? (
                      <select
                        value={preview.sheetName}
                        onChange={(e) => void changeSheet(e.target.value)}
                        className="rounded-md border border-white/15 bg-white/10 px-2 py-1 text-xs text-white [color-scheme:dark]"
                      >
                        {sheetOptions.map((sh) => (
                          <option key={sh.name} value={sh.name} className="bg-ink-800 text-white">
                            {sh.name} — {sh.count} baris
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="font-medium text-white">{preview.sheetName}</span>
                    )}
                    {sheetOptions.length > 1 && (
                      <span className="text-warn-100">
                        File punya {sheetOptions.length} sheet berisi data — sistem memakai sheet terbaru; ganti
                        lewat dropdown bila perlu.
                      </span>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-4 gap-3 text-center">
                  <div>
                    <p className="tnum font-display text-xl font-bold text-white">{preview.kept.length}</p>
                    <p className="text-xs text-ink-300">Baris diimpor</p>
                  </div>
                  <div>
                    <p className="tnum font-display text-xl font-bold text-white">{preview.groups}</p>
                    <p className="text-xs text-ink-300">Permintaan</p>
                  </div>
                  <div>
                    <p className="tnum font-display text-xl font-bold text-white">
                      {preview.lines.reduce((s, l) => s + l.qty, 0)}
                    </p>
                    <p className="text-xs text-ink-300">Total qty</p>
                  </div>
                  <div>
                    <p className={`tnum font-display text-xl font-bold ${preview.unmatched.length > 0 ? "text-warn-100" : "text-brand-100"}`}>
                      {preview.unmatched.length}
                    </p>
                    <p className="text-xs text-ink-300">Barang baru</p>
                  </div>
                </div>

                {qtyBreakdown && (
                  <div className="rounded-md border border-white/15 bg-white/5 p-3 text-xs leading-relaxed text-ink-300">
                    <p>
                      Dari total{" "}
                      <span className="tnum font-semibold text-white">{qtyBreakdown.total} qty</span>:{" "}
                      <span className="tnum font-semibold text-ok-100">{qtyBreakdown.terkirim} akan terkirim</span>{" "}
                      {deductStock ? (
                        <>
                          (stok berkurang
                          {qtyBreakdown.perKondisi.length > 0 && (
                            <>
                              :{" "}
                              {qtyBreakdown.perKondisi
                                .map(([kode, q]) => `${kode} ${q}`)
                                .join(" · ")}
                            </>
                          )}
                          )
                        </>
                      ) : (
                        <>(dicatat terkirim — stok tidak berubah karena opsi &ldquo;Kurangi stok otomatis&rdquo; mati)</>
                      )}{" "}
                      •{" "}
                      <span className="tnum font-semibold text-warn-100">{qtyBreakdown.pending} PENDING</span>{" "}
                      (masuk Sisa Belum Terkirim, stok tidak berkurang).
                    </p>
                    {qtyBreakdown.pending > 0 && (
                      <p className="mt-1">
                        Barang PENDING tidak mengurangi stok dan tidak hilang — tercatat di menu{" "}
                        <span className="font-medium text-white">Sisa Belum Terkirim</span>, bisa dikirim
                        nanti setelah stok tersedia.
                      </p>
                    )}
                  </div>
                )}

                {preview.fulfillments.length > 0 && (
                  <div className="rounded-md border border-ok-500/25 bg-ok-500/15 p-3">
                    <p className="flex items-center gap-2 text-sm font-semibold text-ok-100">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      {preview.fulfillments.length} barang pending akan otomatis terkirim
                    </p>
                    <p className="mt-1 text-xs text-ok-100">
                      Tiket + barang di file ini sama dengan yang masih di Sisa Belum Terkirim — baris
                      pending-nya dilunasi otomatis, bukan dibuat baris baru.
                    </p>
                    <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-ok-100">
                      {preview.fulfillments.map((f, i) => (
                        <li key={`${f.ticket}-${f.itemName}-${f.kodeKondisi}-${i}`} className="flex flex-wrap gap-x-2">
                          <span className="font-mono">{f.ticket}</span>
                          <span className="font-medium text-white">{f.itemName}</span>
                          <span>({asetLabelOf(f.kodeKondisi)})</span>
                          <span className="tnum">
                            lunasi {f.fulfillQty}
                            {f.excessQty > 0 && ` · +${f.excessQty} baru terkirim`}
                            {f.pendingSisaAfter > 0 && ` · sisa pending ${f.pendingSisaAfter}`}
                            {f.needsApprove && ` · akan disetujui dulu`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {sheetDiffLoading && (
                  <div className="flex gap-2 rounded-md bg-white/5 p-3 text-xs text-ink-300">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <div>Mengecek Google Sheet (dokumen pengiriman)…</div>
                  </div>
                )}
                {sheetDiffError && (
                  <div className="rounded-md border border-warn-500/25 bg-warn-500/15 p-3">
                    <p className="flex items-center gap-2 text-sm font-semibold text-warn-100">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      Tidak bisa membandingkan dengan Google Sheet
                    </p>
                    <p className="mt-1 text-xs text-warn-100">
                      {sheetDiffError} Upload tetap bisa dilanjutkan — pengecekan ini hanya pengingat.
                    </p>
                  </div>
                )}
                {sheetDiff && sheetDiffCount(sheetDiff) === 0 && (
                  <div className="rounded-md border border-ok-500/25 bg-ok-500/15 p-3">
                    <p className="flex items-center gap-2 text-sm font-semibold text-ok-100">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      Cocok — file sama dengan Google Sheet
                    </p>
                    <p className="mt-1 text-xs text-ok-100">
                      {sheetDiff.matchedLines} baris ({sheetDiff.totalQtyFile} qty) di file cocok dengan
                      dokumen pengiriman untuk tanggal ini.
                    </p>
                  </div>
                )}
                {sheetDiff && sheetDiffCount(sheetDiff) > 0 && (
                  <div className="rounded-md border border-warn-500/25 bg-warn-500/15 p-3">
                    <p className="flex items-center gap-2 text-sm font-semibold text-warn-100">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      Ada beda dengan Google Sheet (dokumen pengiriman) — {sheetDiffCount(sheetDiff)} selisih
                    </p>
                    <p className="mt-1 text-xs text-warn-100">
                      Ini hanya pengingat untuk di-cek — kamu tetap bisa upload walau ada beda.
                    </p>
                    <div className="mt-2 space-y-2 text-xs text-warn-100">
                      {sheetDiff.fileOnly.length > 0 && (
                        <div>
                          <p className="font-semibold text-white">
                            Ada di file, tidak ada di Sheet ({sheetDiff.fileOnly.length})
                          </p>
                          <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto">
                            {sheetDiff.fileOnly.slice(0, 5).map((l, i) => (
                              <li key={`fo-${l.ticket}-${l.itemName}-${i}`} className="flex flex-wrap gap-x-2">
                                <span className="font-mono">{l.ticket}</span>
                                <span className="font-medium text-white">{l.itemName}</span>
                                <span>({asetLabelOf(l.kondisi)})</span>
                                <span className="tnum">{l.qty} qty</span>
                              </li>
                            ))}
                          </ul>
                          {sheetDiff.fileOnly.length > 5 && (
                            <p className="mt-1">…dan {sheetDiff.fileOnly.length - 5} lagi.</p>
                          )}
                        </div>
                      )}
                      {sheetDiff.sheetOnly.length > 0 && (
                        <div>
                          <p className="font-semibold text-white">
                            Ada di Sheet, tidak ada di file ({sheetDiff.sheetOnly.length})
                          </p>
                          <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto">
                            {sheetDiff.sheetOnly.slice(0, 5).map((l, i) => (
                              <li key={`so-${l.ticket}-${l.itemName}-${i}`} className="flex flex-wrap gap-x-2">
                                <span className="font-mono">{l.ticket}</span>
                                <span className="font-medium text-white">{l.itemName}</span>
                                <span>({asetLabelOf(l.kondisi)})</span>
                                <span className="tnum">{l.qty} qty</span>
                              </li>
                            ))}
                          </ul>
                          {sheetDiff.sheetOnly.length > 5 && (
                            <p className="mt-1">…dan {sheetDiff.sheetOnly.length - 5} lagi.</p>
                          )}
                        </div>
                      )}
                      {sheetDiff.qtyMismatch.length > 0 && (
                        <div>
                          <p className="font-semibold text-white">
                            Qty beda ({sheetDiff.qtyMismatch.length})
                          </p>
                          <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto">
                            {sheetDiff.qtyMismatch.slice(0, 5).map((l, i) => (
                              <li key={`qm-${l.ticket}-${l.itemName}-${i}`} className="flex flex-wrap gap-x-2">
                                <span className="font-mono">{l.ticket}</span>
                                <span className="font-medium text-white">{l.itemName}</span>
                                <span>({asetLabelOf(l.kondisi)})</span>
                                <span className="tnum">file {l.qtyFile} · Sheet {l.qtySheet}</span>
                              </li>
                            ))}
                          </ul>
                          {sheetDiff.qtyMismatch.length > 5 && (
                            <p className="mt-1">…dan {sheetDiff.qtyMismatch.length - 5} lagi.</p>
                          )}
                        </div>
                      )}
                      {sheetDiff.barcodeMismatch.length > 0 && (
                        <div>
                          <p className="font-semibold text-white">
                            Barcode beda ({sheetDiff.barcodeMismatch.length})
                          </p>
                          <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto">
                            {sheetDiff.barcodeMismatch.slice(0, 5).map((l, i) => (
                              <li key={`bm-${l.ticket}-${l.itemName}-${i}`} className="flex flex-wrap gap-x-2">
                                <span className="font-mono">{l.ticket}</span>
                                <span className="font-medium text-white">{l.itemName}</span>
                                <span>({asetLabelOf(l.kondisi)})</span>
                                {l.onlyFile.length > 0 && (
                                  <span className="tnum">hanya di file: {l.onlyFile.slice(0, 3).join(", ")}{l.onlyFile.length > 3 ? ` +${l.onlyFile.length - 3}` : ""}</span>
                                )}
                                {l.onlySheet.length > 0 && (
                                  <span className="tnum">hanya di Sheet: {l.onlySheet.slice(0, 3).join(", ")}{l.onlySheet.length > 3 ? ` +${l.onlySheet.length - 3}` : ""}</span>
                                )}
                              </li>
                            ))}
                          </ul>
                          {sheetDiff.barcodeMismatch.length > 5 && (
                            <p className="mt-1">…dan {sheetDiff.barcodeMismatch.length - 5} lagi.</p>
                          )}
                        </div>
                      )}
                      {sheetDiff.statusMismatch.length > 0 && (
                        <div>
                          <p className="font-semibold text-white">
                            Status PENDING vs TERKIRIM beda ({sheetDiff.statusMismatch.length})
                          </p>
                          <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto">
                            {sheetDiff.statusMismatch.slice(0, 5).map((l, i) => (
                              <li key={`sm-${l.ticket}-${l.itemName}-${i}`} className="flex flex-wrap gap-x-2">
                                <span className="font-mono">{l.ticket}</span>
                                <span className="font-medium text-white">{l.itemName}</span>
                                <span>({asetLabelOf(l.kondisi)})</span>
                                <span className="tnum">PENDING — file {l.pendingFile} · Sheet {l.pendingSheet}</span>
                              </li>
                            ))}
                          </ul>
                          {sheetDiff.statusMismatch.length > 5 && (
                            <p className="mt-1">…dan {sheetDiff.statusMismatch.length - 5} lagi.</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {preview.dateRange && (
                  <p className="text-xs text-ink-300">
                    Tanggal pengiriman di file:{" "}
                    <span className="font-medium text-white">
                      {preview.dateRange.min === preview.dateRange.max
                        ? formatDate(preview.dateRange.min)
                        : `${formatDate(preview.dateRange.min)} – ${formatDate(preview.dateRange.max)}`}
                    </span>{" "}
                    — tanggal ini yang dipakai sebagai tanggal permintaan &amp; keluar stok.
                  </p>
                )}

                {deductStock && minusLoading && (
                  <div className="flex gap-2 rounded-md bg-white/5 p-3 text-xs text-ink-300">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <div>Mengecek stok saat ini…</div>
                  </div>
                )}
                {deductStock && minusWarnings && minusWarnings.length > 0 && (
                  <div className="rounded-md border border-brand-500/25 bg-brand-500/15 p-3">
                    <p className="flex items-center gap-2 text-sm font-semibold text-brand-100">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      Stok akan minus — {minusWarnings.length} barang
                    </p>
                    <p className="mt-1 text-xs text-brand-100">
                      Stok barang ini tidak cukup untuk pengiriman di file. Impor tetap bisa jalan, tapi stok
                      akan tercatat minus — isi stok dulu atau periksa file bila tidak sesuai.
                    </p>
                    <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-brand-100">
                      {minusWarnings.map((w, i) => (
                        <li key={`${w.itemName}-${w.kondisi}-${i}`} className="flex flex-wrap gap-x-2">
                          <span className="font-medium text-white">{w.itemName}</span>
                          <span>({asetLabelOf(w.kondisi)})</span>
                          <span className="tnum">
                            Stok {w.stockNow} · keluar {w.qtyOut} · sisa {w.projected}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {deductStock && minusWarnings && minusWarnings.length === 0 && !minusLoading && (
                  <div className="flex gap-2 rounded-md bg-ok-500/15 p-3 text-xs text-ok-100">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <div>Stok cukup — tidak ada barang yang akan minus.</div>
                  </div>
                )}

                {/* Rincian qty per barang — dipakai untuk mengecek qty sudah sama dengan file */}
                <div className="max-h-72 overflow-auto rounded-md border border-white/15">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 border-b border-white/15 bg-ink-800 text-left text-xs font-semibold uppercase tracking-wide text-ink-300 backdrop-blur">
                      <tr>
                        <th className="px-2 py-1.5 font-medium">Nama barang</th>
                        <th className="px-2 py-1.5 font-medium">Status asset</th>
                        <th className="px-2 py-1.5 font-medium">Terkirim</th>
                        <th className="px-2 py-1.5 text-right font-medium">Qty</th>
                        <th className="px-2 py-1.5 text-right font-medium">Baris</th>
                        <th className="px-2 py-1.5 font-medium">Catatan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.lines.map((l, i) => {
                        const qtyNote =
                          l.qtyFile === 0
                            ? `QTY kosong di file → dihitung ${l.qty} dari ${l.rowCount} baris/barcode`
                            : l.qty > l.qtyFile
                              ? `QTY file ${l.qtyFile} untuk ${l.rowCount} baris → dipakai ${l.qty} unit${l.qtySource === "barcode" ? " (mengikuti jumlah barcode)" : ""}`
                              : l.qty < l.rowCount
                                ? `QTY file ${l.qtyFile} dibagi ke ${l.rowCount} baris (blok di-merge)`
                                : "";
                        const tujuanNote = l.isPending
                          ? "Masuk Sisa Belum Terkirim — stok tidak berkurang"
                          : deductStock
                            ? `Keluar dari ${l.kodeKondisi}`
                            : "Dicatat terkirim — stok tidak berubah";
                        return (
                        <tr key={`${l.itemKey}-${l.kodeKondisi}-${l.isPending}-${i}`} className="border-t border-white/15 transition-colors hover:bg-white/5">
                          <td className="px-2 py-1.5 text-white">
                            {nameOf(l)}
                            {!preview.idByName.has(normalizeItemName(l.itemName)) && (
                              <span className="ml-1 text-warn-100">(baru)</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-ink-300">{asetLabelOf(l.kodeKondisi)}</td>
                          <td className="px-2 py-1.5 text-ink-300">{l.isPending ? "PENDING" : "TERKIRIM"}</td>
                          <td className="tnum px-2 py-1.5 text-right font-semibold text-white">{l.qty}</td>
                          <td className="tnum px-2 py-1.5 text-right text-ink-300">{l.rows.length}</td>
                          <td className={`px-2 py-1.5 ${l.isPending ? "text-warn-100" : "text-ink-300"}`}>
                            {tujuanNote}
                            {qtyNote && <span className="text-warn-100"> · {qtyNote}</span>}
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {preview.unmatched.length > 0 && (
                  <div className="flex gap-2 rounded-md bg-warn-500/15 p-3 text-xs text-warn-100">
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
                  <div className="flex gap-2 rounded-md bg-warn-500/15 p-3 text-xs text-warn-100">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <div>
                      {preview.skipped.length} baris sudah ada di sistem (tiket + barang + barcode/resi sama)
                      → dilewati: baris {preview.skipped.slice(0, 8).map((r) => r.rowNo).join(", ")}
                      {preview.skipped.length > 8 && `, +${preview.skipped.length - 8} lainnya`}.
                    </div>
                  </div>
                )}
                {preview.lines.some((l) => l.qtyFile > 0 && l.qty > l.qtyFile) && (
                  <div className="flex gap-2 rounded-md bg-warn-500/15 p-3 text-xs text-warn-100">
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
                  <div className="flex gap-2 rounded-md bg-warn-500/15 p-3 text-xs text-warn-100">
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
                  <div className="flex gap-2 rounded-md bg-warn-500/15 p-3 text-xs text-warn-100">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <div>
                      {preview.rows.filter((r) => !r.dateExplicit).length} baris tanpa tanggal di file (baris{" "}
                      {preview.rows.filter((r) => !r.dateExplicit).slice(0, 8).map((r) => r.rowNo).join(", ")}
                      {preview.rows.filter((r) => !r.dateExplicit).length > 8 ? ", …" : ""}) — sistem memakai
                      tanggal sheet \"{(preview.sheetName ?? "").trim()}\" untuk baris tersebut. Lengkapi kolom In
                      Progress Date bila tanggalnya beda.
                    </div>
                  </div>
                )}
                {preview.rows.some((r) => r.qtyUnreadable) && (
                  <div className="flex gap-2 rounded-md bg-warn-500/15 p-3 text-xs text-warn-100">
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
                  <div className="flex gap-2 rounded-md bg-warn-500/15 p-3 text-xs text-warn-100">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <div>
                      {preview.dupsInFile.length} baris punya tiket + barang + barcode/resi sama di dalam file
                      (baris {preview.dupsInFile.slice(0, 8).map((r) => r.rowNo).join(", ")}). Baris tetap
                      diproses — hapus di Excel bila memang dobel.
                    </div>
                  </div>
                )}
                {preview.existingTickets.length > 0 && (
                  <div className="flex gap-2 rounded-md bg-white/5 p-3 text-xs text-ink-300">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <div>
                      Tiket {preview.existingTickets.slice(0, 5).join(", ")}
                      {preview.existingTickets.length > 5 && ` (+${preview.existingTickets.length - 5})`} sudah ada
                      di sistem. Baris yang identik dilewati; baris baru digabung ke permintaan yang sudah ada
                      (tiket + gerai sama)
                      {preview.mergeGroups > 0 && ` — ${preview.mergeGroups} grup akan digabung`}.
                    </div>
                  </div>
                )}
              </div>
            )}

            {result && (
              <div className="space-y-3">
                <div className="flex gap-2 rounded-md bg-brand-500/15 p-3 text-sm text-brand-100">
                  <CheckCircle2 className="h-5 w-5 shrink-0" />
                  <p>{result}</p>
                </div>
                {failList.length > 0 && (
                  <div className="rounded-md border border-brand-500/25 bg-brand-500/15 p-3">
                    <p className="mb-2 text-sm font-semibold text-brand-100">
                      Rincian kegagalan ({failList.length}):
                    </p>
                    <ul className="max-h-64 space-y-1.5 overflow-y-auto text-sm text-brand-100">
                      {failList.map((f, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="shrink-0 font-mono font-semibold text-brand-100">{f.ticket}:</span>
                          <span>{f.detail}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </GlassCard>

        <div className="space-y-4">
        <GlassCard>
          <CardHeader>
            <CardTitle className="font-display text-base text-white">Opsi Import</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={deductStock}
                onChange={(e) => setDeductStock(e.target.checked)}
                className="mt-1 accent-brand-600"
              />
              <span>
                <span className="block text-sm font-medium text-white">Kurangi stok otomatis</span>
                <span className="block text-xs text-ink-300">
                  Buat transaksi barang keluar untuk tiap pengiriman. Matikan jika dokumen sudah lama dan stok sudah sesuai.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={autoCreate}
                onChange={(e) => setAutoCreate(e.target.checked)}
                className="mt-1 accent-brand-600"
              />
              <span>
                <span className="block text-sm font-medium text-white">Buat barang baru otomatis</span>
                <span className="block text-xs text-ink-300">
                  Nama barang yang tidak cocok dengan master akan dibuatkan data barang baru.
                </span>
              </span>
            </label>
            <Button onClick={runImport} disabled={!preview || importing} className="w-full">
              <Upload className="mr-1 h-4 w-4" />
              {importing ? "Mengimpor…" : "Import ke Sistem"}
            </Button>
            {importing && progress && <p className="text-xs text-ink-300">{progress}</p>}
            <div className="text-xs text-ink-300">
              <Label className="mb-1 block text-white">Cara pakai</Label>
              1. Download template, isi datanya.
              <br />
              2. Upload file yang sudah terisi (sheet terbaru otomatis dipakai).
              <br />
              3. Cek tabel pratinjau — pastikan QTY per barang sudah sama dengan file, dan perhatikan
              peringatan stok minus bila ada.
              <br />
              4. Klik Import.
            </div>
          </CardContent>
        </GlassCard>
        <SheetSyncPanel />
        </div>
      </div>
    </div>
  );
}
