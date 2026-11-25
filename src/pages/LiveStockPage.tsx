import { useEffect, useRef, useState } from "react";
import type { HTMLAttributes } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import * as XLSX from "xlsx";
import { AlertTriangle, ChevronDown, FileSpreadsheet, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { loadStockReport, type StockIntegrityRow } from "../lib/stockPeriod";
import {
  PIVOT_MAX_DAYS,
  buildPivotSeries,
  buildPivotWorkbook,
  eachDay,
  type PivotBalance,
  type PivotItemInfo,
  type PivotMove,
} from "../lib/pivotStock";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select } from "../components/ui/select";
import { CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { cn } from "../lib/utils";
import { DataTable } from "../components/DataTable";
import { exportToCsv } from "../lib/csv";

interface WarehouseOption {
  value: string;
  label: string;
}

interface LiveStockRow {
  sku: string;
  item: string;
  location: string;
  /** Kode lokasi (STOK-BARU / STOK-RETUR / STOK-UNREADY) — untuk pisah sheet Excel. */
  locCode: string;
  stokAwal: number;
  inQty: number;
  outQty: number;
  stokAkhir: number;
  /** false = riwayat (stok awal dasar + ledger) tidak sama dengan saldo live. */
  reconciled: boolean;
}

function firstOfMonth(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
}

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const fmt = (n: number) =>
  n.toLocaleString("id-ID", { maximumFractionDigits: 3 });

const safeFileName = (s: string) => s.replace(/[^\w-]+/g, "-");

/** Permukaan kaca gelap — sama seperti dashboard. */
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


const right = "text-right";
const liveStockColumns: ColumnDef<LiveStockRow, unknown>[] = [
  { header: "SKU", accessorKey: "sku" },
  { header: "Item", accessorKey: "item" },
  { header: "Lokasi", accessorKey: "location" },
  {
    header: "Stok Awal",
    accessorKey: "stokAwal",
    cell: ({ row }) => <span className={right}>{fmt(row.original.stokAwal)}</span>,
  },
  {
    header: "IN",
    accessorKey: "inQty",
    cell: ({ row }) => <span className={right}>{fmt(row.original.inQty)}</span>,
  },
  {
    header: "OUT",
    accessorKey: "outQty",
    cell: ({ row }) => <span className={right}>{fmt(row.original.outQty)}</span>,
  },
  {
    header: "Stok Akhir",
    accessorKey: "stokAkhir",
    cell: ({ row }) => (
      <span className={`${right} inline-flex items-center gap-1 font-medium`}>
        {!row.original.reconciled && (
          <AlertTriangle
            className="h-3.5 w-3.5 text-warn-500"
            aria-label="Riwayat stok tidak sinkron"
          />
        )}
        {fmt(row.original.stokAkhir)}
      </span>
    ),
  },
];

export function LiveStockPage() {
  const { isSuperAdmin } = useAuth();
  const [warehouseId, setWarehouseId] = useState("");
  const [startDate, setStartDate] = useState(firstOfMonth);
  const [endDate, setEndDate] = useState(todayLocal);
  const [warehouseOptions, setWarehouseOptions] = useState<WarehouseOption[]>([]);
  const [rows, setRows] = useState<LiveStockRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [pivotLoading, setPivotLoading] = useState(false);
  const [integrity, setIntegrity] = useState<StockIntegrityRow[]>([]);
  /** "rpc" = fungsi SQL sudah terpasang; "fallback" = migrasi belum dijalankan. */
  const [reportVia, setReportVia] = useState<"rpc" | "fallback" | null>(null);
  const [aligning, setAligning] = useState(false);
  const [activeLocIds, setActiveLocIds] = useState<string[]>([]);
  const downloadMenuRef = useRef<HTMLDivElement>(null);

  // Tutup menu Download saat klik di luar atau tekan Escape.
  useEffect(() => {
    if (!downloadOpen) return;
    const onDown = (e: MouseEvent) => {
      if (
        downloadMenuRef.current &&
        !downloadMenuRef.current.contains(e.target as Node)
      )
        setDownloadOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDownloadOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [downloadOpen]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("warehouses")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (cancelled) return;
      if (error) {
        toast.error(`Gagal memuat gudang: ${error.message}`);
        return;
      }
      const opts = ((data ?? []) as { id: string; name: string }[]).map((w) => ({
        value: w.id,
        label: w.name,
      }));
      setWarehouseOptions(opts);
      // Default: Gudang Utama bila ada (seluruh stok ada di sana) — kalau tidak,
      // gudang pertama seperti sebelumnya.
      if (opts.length > 0)
        setWarehouseId(
          opts.find((o) => o.label === "Gudang Utama")?.value ?? opts[0].value
        );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadReport = async () => {
    if (!warehouseId) {
      toast.error("Pilih gudang dulu.");
      return;
    }
    if (startDate > endDate) {
      toast.error("Tanggal awal tidak boleh setelah tanggal akhir.");
      return;
    }
    setLoading(true);
    try {
      // Lokasi-lokasi gudang ini.
      const { data: locData, error: locErr } = await supabase
        .from("locations")
        .select("id, name, code")
        .eq("warehouse_id", warehouseId)
        .eq("is_active", true);
      if (locErr) throw new Error(locErr.message);
      const locs = (locData ?? []) as { id: string; name: string; code: string }[];
      if (locs.length === 0) {
        setRows([]);
        setSearched(true);
        return;
      }
      const locIds = locs.map((l) => l.id);
      setActiveLocIds(locIds);
      const locName = new Map(locs.map((l) => [l.id, l.name]));
      const locCode = new Map(locs.map((l) => [l.id, l.code]));

      // SATU rumus untuk Stok Awal / IN / OUT / Stok Akhir:
      // dihitung dari saldo live + ledger menurut TANGGAL TRANSAKSI, sehingga
      // Stok Awal + IN - OUT = Stok Akhir selalu benar, juga untuk periode
      // lampau (Stok Akhir = saldo akhir periode itu, bukan saldo hari ini).
      const report = await loadStockReport(supabase, locIds, startDate, endDate);
      const repRows = report.rows;

      // Nama & SKU item.
      const itemIds = [...new Set(repRows.map((r) => r.item_id))];
      const itemMap = new Map<string, { sku: string; name: string }>();
      for (let i = 0; i < itemIds.length; i += 100) {
        const chunk = itemIds.slice(i, i + 100);
        const { data, error } = await supabase
          .from("inventory_items")
          .select("id, sku, name")
          .in("id", chunk);
        if (error) throw new Error(error.message);
        for (const it of (data ?? []) as { id: string; sku: string; name: string }[])
          itemMap.set(it.id, { sku: it.sku, name: it.name });
      }

      const result: LiveStockRow[] = [];
      for (const r of repRows) {
        // Lewati baris yang sepenuhnya nol agar laporan ringkas.
        if (
          r.opening === 0 &&
          r.totalIn === 0 &&
          r.totalOut === 0 &&
          r.closing === 0
        )
          continue;
        const info = itemMap.get(r.item_id) ?? { sku: "-", name: "(item dihapus)" };
        result.push({
          sku: info.sku,
          item: info.name,
          location: locName.get(r.location_id) ?? "-",
          locCode: locCode.get(r.location_id) ?? "",
          stokAwal: r.opening,
          inQty: r.totalIn,
          outQty: r.totalOut,
          stokAkhir: r.closing,
          reconciled: r.reconciled,
        });
      }
      result.sort((a, b) => a.item.localeCompare(b.item, "id"));
      setRows(result);
      setSearched(true);

      // Audit selisih historis sudah ikut dihitung pada loader yang sama.
      setIntegrity(report.integrity);
      setReportVia(report.via);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal memuat laporan.");
    } finally {
      setLoading(false);
    }
  };

  /**
   * Selaraskan Stok Awal dasar dengan riwayat (khusus Super Admin).
   * Stok fisik dan seluruh transaksi TIDAK diubah; hanya angka dasar
   * "Stok Awal" yang diluruskan sehingga laporan periode apa pun cocok.
   */
  const alignBaselines = async () => {
    if (!isSuperAdmin || activeLocIds.length === 0) return;
    if (
      !window.confirm(
        `Selaraskan Stok Awal dasar untuk ${integrity.length} baris (${fmt(
          integrity.reduce((a, r) => a + Math.abs(r.drift), 0)
        )} unit selisih historis)?\n\nStok fisik tidak berubah dan semua transaksi tetap utuh — hanya angka dasar Stok Awal yang disesuaikan dengan riwayat. Tindakan ini tercatat di Audit Log.`
      )
    )
      return;
    setAligning(true);
    try {
      const { data, error } = await supabase.rpc("align_stock_opening_baselines", {
        p_location_ids: activeLocIds,
      });
      if (error) throw new Error(error.message);
      const res = (data ?? {}) as { rows_aligned?: number };
      toast.success(
        `${res.rows_aligned ?? integrity.length} baris diselaraskan. Stok fisik tidak berubah.`
      );
      await loadReport();
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message
          : "Gagal menyelaraskan. Pastikan migrasi stock_consistency sudah dijalankan."
      );
    } finally {
      setAligning(false);
    }
  };

  const exportCsv = () => {
    if (rows.length === 0) {
      toast.error("Tidak ada data untuk diekspor.");
      return;
    }
    exportToCsv(
      `live-stok-${startDate}_${endDate}`,
      rows.map((r) => ({
        SKU: r.sku,
        Item: r.item,
        Lokasi: r.location,
        "Stok Awal": r.stokAwal,
        IN: r.inQty,
        OUT: r.outQty,
        "Stok Akhir": r.stokAkhir,
      }))
    );
  };

  /**
   * Unduh laporan Live Stok sebagai Excel (.xlsx), dipisah per jenis stok:
   * sheet "Barang Baru" (STOK-BARU), "Return" (STOK-RETUR), "Unready"
   * (STOK-UNREADY — hanya bila ada isinya), plus sheet "Ringkasan" berisi
   * total per kategori. Setiap sheet berisi Stok Awal / IN / OUT / Stok Akhir
   * (sisa qty) + baris TOTAL di bawah.
   */
  const exportExcel = () => {
    if (rows.length === 0) {
      toast.error("Tidak ada data untuk diekspor.");
      return;
    }
    // Pisah per jenis stok dari AKHIRAN kode lokasi (STOK-BARU, CEMPAKA_PUTIH-BARU,
    // dst.) — bukan kode persis, supaya gudang lain yang kodenya beda tetap
    // masuk sheet yang benar.
    const baru = rows.filter((r) => r.locCode.endsWith("-BARU"));
    const retur = rows.filter((r) => r.locCode.endsWith("-RETUR"));
    const unready = rows.filter(
      (r) => !r.locCode.endsWith("-BARU") && !r.locCode.endsWith("-RETUR")
    );

    const sumRows = (rs: LiveStockRow[]) => ({
      items: rs.length,
      awal: rs.reduce((a, r) => a + r.stokAwal, 0),
      inQty: rs.reduce((a, r) => a + r.inQty, 0),
      outQty: rs.reduce((a, r) => a + r.outQty, 0),
      akhir: rs.reduce((a, r) => a + r.stokAkhir, 0),
    });
    const total = sumRows(rows);
    const whName =
      warehouseOptions.find((w) => w.value === warehouseId)?.label ?? "-";

    const wb = XLSX.utils.book_new();

    // --- Sheet Ringkasan ---
    const ringkasanRows: (string | number)[][] = [
      ["Laporan Live Stok"],
      [`Gudang: ${whName}`],
      [`Periode: ${startDate} s/d ${endDate}`],
      [`Diunduh: ${new Date().toLocaleString("id-ID")}`],
      [],
      ["Kategori", "Jumlah Item", "Stok Awal", "IN", "OUT", "Stok Akhir"],
      ["Barang Baru", ...Object.values(sumRows(baru))],
      ["Return", ...Object.values(sumRows(retur))],
    ];
    if (unready.length > 0)
      ringkasanRows.push(["Unready", ...Object.values(sumRows(unready))]);
    ringkasanRows.push(["TOTAL", total.items, total.awal, total.inQty, total.outQty, total.akhir]);
    const wsRingkasan = XLSX.utils.aoa_to_sheet(ringkasanRows);
    wsRingkasan["!cols"] = [
      { wch: 16 },
      { wch: 12 },
      { wch: 12 },
      { wch: 10 },
      { wch: 10 },
      { wch: 12 },
    ];
    XLSX.utils.book_append_sheet(wb, wsRingkasan, "Ringkasan");

    // --- Satu sheet per jenis stok ---
    const detailCols = [
      { wch: 14 }, // SKU
      { wch: 42 }, // Item
      { wch: 22 }, // Lokasi
      { wch: 12 }, // Stok Awal
      { wch: 10 }, // IN
      { wch: 10 }, // OUT
      { wch: 12 }, // Stok Akhir
    ];
    const addDetailSheet = (name: string, rs: LiveStockRow[]) => {
      const s = sumRows(rs);
      const data = rs.map((r) => ({
        SKU: r.sku,
        Item: r.item,
        Lokasi: r.location,
        "Stok Awal": r.stokAwal,
        IN: r.inQty,
        OUT: r.outQty,
        "Stok Akhir": r.stokAkhir,
      }));
      data.push({
        SKU: "",
        Item: "TOTAL",
        Lokasi: "",
        "Stok Awal": s.awal,
        IN: s.inQty,
        OUT: s.outQty,
        "Stok Akhir": s.akhir,
      });
      const ws = XLSX.utils.json_to_sheet(data);
      ws["!cols"] = detailCols;
      XLSX.utils.book_append_sheet(wb, ws, name);
    };
    addDetailSheet("Barang Baru", baru);
    addDetailSheet("Return", retur);
    if (unready.length > 0) addDetailSheet("Unready", unready);

    const filename = `Live-Stok-${safeFileName(whName)}-${startDate}_sd_${endDate}.xlsx`;
    XLSX.writeFile(wb, filename);
    toast.success(`Laporan Excel diunduh: ${filename}`);
  };

  /**
   * Unduh laporan Stok Pivot sebagai Excel (.xlsx) — model file
   * Laporan_Stok_Pivot dari Anggi: baris = barang, kolom = tanggal
   * (pivot ke samping), isi = stok akhir per tanggal. Sheet dipisah per
   * jenis stok (Barang Baru / Return / Unready) + sheet Ringkasan.
   * Tanggal yang dipakai adalah TANGGAL TRANSAKSI (tanggal pengiriman /
   * tanggal bisnis), bukan tanggal input — jadi pengiriman 10 Nov yang
   * diunggah 11 Nov tetap tercatat di kolom 10 Nov.
   */
  const exportPivotExcel = async () => {
    if (!warehouseId) {
      toast.error("Pilih gudang dulu.");
      return;
    }
    if (startDate > endDate) {
      toast.error("Tanggal awal tidak boleh setelah tanggal akhir.");
      return;
    }
    const dates = eachDay(startDate, endDate);
    if (dates.length > PIVOT_MAX_DAYS) {
      toast.error(
        `Rentang pivot maksimal ${PIVOT_MAX_DAYS} hari (saat ini ${dates.length} hari). Persempit tanggalnya.`,
      );
      return;
    }
    setPivotLoading(true);
    try {
      // Lokasi-lokasi gudang ini.
      const { data: locData, error: locErr } = await supabase
        .from("locations")
        .select("id, name, code")
        .eq("warehouse_id", warehouseId)
        .eq("is_active", true);
      if (locErr) throw new Error(locErr.message);
      const locs = (locData ?? []) as { id: string; name: string; code: string }[];
      if (locs.length === 0) {
        toast.error("Gudang ini belum punya lokasi.");
        return;
      }
      const locIds = locs.map((l) => l.id);
      const locName = new Map(locs.map((l) => [l.id, l.name]));
      const locCode = new Map(locs.map((l) => [l.id, l.code]));

      // Saldo saat ini per (item, lokasi) + saldo awal (untuk cek rekonsiliasi).
      const { data: balData, error: balErr } = await supabase
        .from("inventory_balances")
        .select("item_id, location_id, qty, opening_qty")
        .in("location_id", locIds);
      if (balErr) throw new Error(balErr.message);
      const balances = ((balData ?? []) as {
        item_id: string;
        location_id: string;
        qty: number | string;
        opening_qty: number | string | null;
      }[]).map((b) => ({
        item_id: b.item_id,
        location_id: b.location_id,
        qty: Number(b.qty),
        opening: Number(b.opening_qty ?? 0),
      })) as PivotBalance[];

      // Seluruh mutasi ledger gudang ini (paginasi per 1.000 baris).
      // Tanggal transaksi diambil terpisah karena ledger hanya menyimpan
      // transaction_id + created_at.
      const ledRaw: {
        item_id: string;
        location_id: string;
        qty_change: number | string;
        transaction_id: string;
        created_at: string;
      }[] = [];
      const pageSize = 1000;
      let offset = 0;
      while (true) {
        const { data: ledBatch, error: ledErr } = await supabase
          .from("inventory_ledger")
          .select("item_id, location_id, qty_change, transaction_id, created_at")
          .in("location_id", locIds)
          .order("id", { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (ledErr) throw new Error(ledErr.message);
        const batch = (ledBatch ?? []) as {
          item_id: string;
          location_id: string;
          qty_change: number | string;
          transaction_id: string;
          created_at: string;
        }[];
        ledRaw.push(...batch);
        if (batch.length < pageSize) break;
        offset += pageSize;
      }

      // Tanggal transaksi per id (chunk 200) — fallback ke created_at bila hilang.
      const txnIds = [...new Set(ledRaw.map((r) => r.transaction_id))];
      const txnDate = new Map<string, string>();
      for (let i = 0; i < txnIds.length; i += 200) {
        const chunk = txnIds.slice(i, i + 200);
        const { data: txnData, error: txnErr } = await supabase
          .from("inventory_transactions")
          .select("id, transaction_date")
          .in("id", chunk);
        if (txnErr) throw new Error(txnErr.message);
        for (const t of (txnData ?? []) as { id: string; transaction_date: string }[])
          txnDate.set(t.id, t.transaction_date);
      }
      // Semua mutasi (tanpa filter tanggal): mutasi sebelum periode tidak
      // memengaruhi tanggal mana pun, tapi dibutuhkan untuk cek rekonsiliasi
      // riwayat (saldo awal + mutasi = saldo kini).
      const moves: PivotMove[] = ledRaw.map((r) => ({
        item_id: r.item_id,
        location_id: r.location_id,
        qty_change: Number(r.qty_change),
        txnDate: txnDate.get(r.transaction_id) ?? r.created_at.slice(0, 10),
      }));

      // Nama / SKU / Stok Minimum (Buffer) / satuan item.
      const itemIds = [
        ...new Set([
          ...balances.map((b) => b.item_id),
          ...moves.map((m) => m.item_id),
        ]),
      ];
      const itemMap = new Map<
        string,
        { sku: string; name: string; buffer: number; unitId: string | null }
      >();
      for (let i = 0; i < itemIds.length; i += 100) {
        const chunk = itemIds.slice(i, i + 100);
        const { data, error } = await supabase
          .from("inventory_items")
          .select("id, sku, name, min_stock, unit_id")
          .in("id", chunk);
        if (error) throw new Error(error.message);
        for (const it of (data ?? []) as {
          id: string;
          sku: string;
          name: string;
          min_stock: number | null;
          unit_id: string | null;
        }[])
          itemMap.set(it.id, {
            sku: it.sku,
            name: it.name,
            buffer: Number(it.min_stock ?? 0),
            unitId: it.unit_id,
          });
      }
      const { data: unitData, error: unitErr } = await supabase
        .from("units")
        .select("id, code");
      if (unitErr) throw new Error(unitErr.message);
      const unitCode = new Map(
        ((unitData ?? []) as { id: string; code: string }[]).map((u) => [
          u.id,
          (u.code ?? "-").toUpperCase(),
        ]),
      );

      const info = new Map<string, PivotItemInfo>();
      for (const key of new Set([
        ...balances.map((b) => `${b.item_id}|${b.location_id}`),
        ...moves.map((m) => `${m.item_id}|${m.location_id}`),
      ])) {
        const [itemId, locId] = key.split("|");
        const it = itemMap.get(itemId);
        if (!it) continue;
        info.set(key, {
          sku: it.sku,
          name: it.name,
          unit: (it.unitId ? unitCode.get(it.unitId) : undefined) ?? "-",
          buffer: it.buffer,
          locCode: locCode.get(locId) ?? "",
          locName: locName.get(locId) ?? "-",
        });
      }

      const pivotRows = buildPivotSeries(balances, moves, dates, info);
      if (pivotRows.length === 0) {
        toast.error("Tidak ada data untuk pivot pada periode ini.");
        return;
      }
      const whName =
        warehouseOptions.find((w) => w.value === warehouseId)?.label ?? "-";
      const wb = buildPivotWorkbook({
        rows: pivotRows,
        dates,
        whName,
        startDate,
        endDate,
      });
      const filename = `Pivot-Stok-${safeFileName(whName)}-${startDate}_sd_${endDate}.xlsx`;
      XLSX.writeFile(wb, filename);
      toast.success(`Laporan pivot diunduh: ${filename}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengunduh pivot.");
    } finally {
      setPivotLoading(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Live Stok"
        description="Posisi stok per gudang ala Excel LIVE STOK: Stok Awal / IN / OUT / Stok Akhir menurut tanggal transaksi. Stok Awal + IN − OUT = Stok Akhir."
      />
      <GlassCard>
        <CardHeader>
          <CardTitle className="text-white">Filter Laporan</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="ls-wh" className="text-ink-300">Gudang</Label>
              <Select
                id="ls-wh"
                className="border-white/15 bg-white/10 text-white [color-scheme:dark]"
                options={warehouseOptions}
                placeholder="Pilih gudang"
                value={warehouseId}
                onValueChange={setWarehouseId}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ls-start" className="text-ink-300">Dari Tanggal</Label>
              <Input
                id="ls-start"
                type="date"
                className="border-white/15 bg-white/10 text-white placeholder:text-ink-300 [color-scheme:dark]"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ls-end" className="text-ink-300">Sampai Tanggal</Label>
              <Input
                id="ls-end"
                type="date"
                className="border-white/15 bg-white/10 text-white placeholder:text-ink-300 [color-scheme:dark]"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Button onClick={loadReport} disabled={loading}>
                {loading ? "Memuat…" : "Tampilkan"}
              </Button>
              <Button variant="outline" className={DARK_OUTLINE_BTN} onClick={exportCsv} disabled={rows.length === 0}>
                Export CSV
              </Button>
              <div className="relative" ref={downloadMenuRef}>
                <Button
                  variant="outline"
                  className={DARK_OUTLINE_BTN}
                  onClick={() => setDownloadOpen((v) => !v)}
                  disabled={!warehouseId}
                  aria-haspopup="menu"
                  aria-expanded={downloadOpen}
                >
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  Download
                  <ChevronDown className="ml-2 h-4 w-4" />
                </Button>
                {downloadOpen && (
                  <div className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-xl border border-white/15 bg-ink-800 shadow-[0_8px_32px_rgba(2,6,23,0.5)]">
                    <button
                      type="button"
                      className="block w-full px-4 py-2.5 text-left text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={rows.length === 0}
                      onClick={() => {
                        setDownloadOpen(false);
                        exportExcel();
                      }}
                    >
                      Live Stok (Excel)
                      <span className="block text-xs text-ink-300">
                        Stok Awal / IN / OUT / Stok Akhir
                      </span>
                    </button>
                    <button
                      type="button"
                      className="block w-full px-4 py-2.5 text-left text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={pivotLoading}
                      onClick={() => {
                        setDownloadOpen(false);
                        void exportPivotExcel();
                      }}
                    >
                      {pivotLoading ? "Mengunduh pivot…" : "Pivot per Tanggal (Excel)"}
                      <span className="block text-xs text-ink-300">
                        Stok akhir per tanggal, pisah Baru / Return / Unready
                      </span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </GlassCard>

      {integrity.length > 0 && (
        <div className="mt-6 rounded-2xl border border-warn-500/40 bg-warn-500/10 p-4 text-sm text-white">
          <div className="flex flex-wrap items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warn-500" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {integrity.length} baris punya selisih historis (
                {fmt(integrity.reduce((a, r) => a + Math.abs(r.drift), 0))} unit)
              </p>
              <p className="mt-1 text-ink-300">
                Artinya saldo saat ini tidak sama dengan Stok Awal dasar + seluruh mutasi
                tercatat — biasanya sisa data lama/ubah stok sebelum semua transaksi lewat
                buku besar. Laporan di bawah tetap seimbang (Stok Awal + IN − OUT = Stok
                Akhir). Selaraskan agar Stok Awal dasar ikut cocok; stok fisik tidak berubah.
              </p>
              {isSuperAdmin && (
                <Button
                  variant="outline"
                  size="sm"
                  className={`${DARK_OUTLINE_BTN} mt-3`}
                  onClick={() => void alignBaselines()}
                  disabled={aligning}
                >
                  <ShieldCheck className="mr-2 h-4 w-4" />
                  {aligning ? "Menyelaraskan…" : "Selaraskan Stok Awal dasar"}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {searched && reportVia !== null && (
        <p
          className={`mt-4 text-xs ${
            reportVia === "rpc" ? "text-ok-100" : "text-warn-100"
          }`}
        >
          {reportVia === "rpc"
            ? "✓ Mesin laporan SQL aktif (stock_period_report) — laporan cepat & panel audit tersedia."
            : "⚠ Migrasi SQL stock_consistency belum terpasang. Angka tetap benar (mode kompatibilitas), tetapi lebih lambat dan penyelarasan belum bisa dijalankan. Jalankan docs/sql/stock_consistency.sql di Supabase."}
        </p>
      )}

      <div className="mt-6">
        <DataTable<LiveStockRow>
          columns={liveStockColumns}
          data={rows}
          loading={loading}
          emptyTitle={searched ? "Tidak ada data" : "Belum ada laporan"}
          emptyDescription={
            searched
              ? "Tidak ada pergerakan/saldo pada periode ini."
              : "Atur filter lalu klik Tampilkan."
          }
        />
      </div>
    </div>
  );
}
