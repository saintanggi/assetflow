import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, Hourglass, PackageCheck, Pencil, Printer, Scissors, Send, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";
import { Skeleton } from "../components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Select } from "../components/ui/select";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import {
  EXCEL_STATUS_ASET_LABELS,
  EXCEL_STATUS_ASET_LOKASI,
  REQUEST_STATUS_LABELS,
  REQUEST_ITEM_STATUS_LABELS,
  STATUS_REQUEST_LABELS,
  STATUS_REQUEST_OPTIONS,
  type ExcelStatusAset,
  type Request,
  type RequestItem,
  type RequestStatus,
  type StatusRequest,
} from "../types/database";
import {
  formatRequestStatus,
  parseRequestStatus,
  parseStatusAset,
} from "../lib/requestStatus";
import {
  ASET_BY_LOCATION_CODE,
  bestAlternativeLocation,
  formatShipError,
  locKey,
  stockBreakdown,
  targetLocationOf,
  type LocationRow,
  type StockByLocationMap,
  type StockMap,
} from "../features/requests/shipStock";
import {
  describeItemDelete,
  formatDeleteItemResult,
} from "../features/requests/deleteItem";
import {
  describeItemChange,
  formatStockMoveResult,
  isMissingRpcError,
  needsStockMove,
} from "../features/requests/itemCorrection";
import {
  buildRequestReviewPlan,
  canRecoverZeroQtyItem,
  withWaitingStockNote,
} from "../features/requests/review";

const STATUS_VARIANT: Record<RequestStatus, "default" | "info" | "warning" | "success" | "destructive" | "secondary"> = {
  diajukan: "info",
  disetujui: "success",
  disetujui_sebagian: "warning",
  ditolak: "destructive",
  diproses: "warning",
  selesai: "secondary",
};

const ITEM_VARIANT: Record<string, "default" | "info" | "warning" | "success" | "destructive" | "secondary"> = {
  menunggu: "info",
  disetujui: "success",
  ditolak: "destructive",
  diproses: "warning",
  siap: "success",
  terkirim: "secondary",
  pending_sebagian: "warning",
  menunggu_stok: "warning",
};

const fmt = (n: number) => Number(n).toLocaleString("id-ID", { maximumFractionDigits: 3 });

export function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, hasPermission, isSuperAdmin } = useAuth();
  const [req, setReq] = useState<Request | null>(null);
  const [items, setItems] = useState<RequestItem[]>([]);
  const [stock, setStock] = useState<StockMap>({});
  const [stockByLoc, setStockByLoc] = useState<StockByLocationMap>({});
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Edit item (superadmin) — revisi data per baris.
  const [editItem, setEditItem] = useState<RequestItem | null>(null);
  const [masterItems, setMasterItems] = useState<{ id: string; name: string }[]>([]);
  const [eItemId, setEItemId] = useState("");
  const [eBarcode, setEBarcode] = useState("");
  const [eSn, setESn] = useState("");
  const [eResi, setEResi] = useState("");
  const [eStatusReq, setEStatusReq] = useState<StatusRequest>("PENAMBAHAN");
  const [eDurasiPinjam, setEDurasiPinjam] = useState("");
  const [eStatusAset, setEStatusAset] = useState<ExcelStatusAset>("ASSET BARU");
  const [eKet, setEKet] = useState("");
  const [eSaving, setESaving] = useState(false);
  const [eDeleting, setEDeleting] = useState(false);

  // Review state (admin gudang)
  const [approved, setApproved] = useState<Record<string, string>>({});
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [warehouseNote, setWarehouseNote] = useState("");
  const [restoreStockItem, setRestoreStockItem] = useState<RequestItem | null>(null);
  const [restoreStockNote, setRestoreStockNote] = useState("");

  // Process state (helper)
  const [proc, setProc] = useState<Record<string, { barcode: string; sn: string; type: string }>>({});
  const [printMode, setPrintMode] = useState<"picklist" | "surat_jalan">("picklist");

  // Ship state (admin gudang)
  const [shipQty, setShipQty] = useState<Record<string, string>>({});
  const [shipResi, setShipResi] = useState<Record<string, string>>({});
  const [shipLocation, setShipLocation] = useState("");

  const canReview = hasPermission("requests.review");
  const canProcess = hasPermission("requests.process");

  const load = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [{ data: r, error: rErr }, { data: it, error: itErr }] = await Promise.all([
        supabase.from("requests").select("*").eq("id", id).single(),
        supabase
          .from("request_items")
          .select("*, inventory_items(sku, name, brand)")
          .eq("request_id", id)
          .order("created_at"),
      ]);
      if (rErr) throw new Error(rErr.message);
      if (itErr) throw new Error(itErr.message);
      setReq(r as Request);
      const its = (it ?? []) as RequestItem[];
      setItems(its);

      // Master barang untuk dropdown ganti item (superadmin).
      const { data: mi } = await supabase
        .from("inventory_items")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      setMasterItems(((mi ?? []) as { id: string; name: string }[]));

      // Stok tersedia per barang (total) + per lokasi (untuk panel kirim).
      const itemIds = its.map((x) => x.item_id);
      if (itemIds.length > 0) {
        const { data: bal } = await supabase
          .from("inventory_balances")
          .select("item_id, location_id, qty")
          .in("item_id", itemIds);
        const m: StockMap = {};
        const mLoc: StockByLocationMap = {};
        for (const b of (bal ?? []) as {
          item_id: string;
          location_id: string;
          qty: number | string;
        }[]) {
          const q = Number(b.qty);
          m[b.item_id] = (m[b.item_id] ?? 0) + q;
          mLoc[locKey(b.item_id, b.location_id)] = q;
        }
        setStock(m);
        setStockByLoc(mLoc);
      }

      const { data: locs } = await supabase
        .from("locations")
        .select("id, code, name")
        .eq("is_active", true)
        .order("code")
        .limit(100);
      const locList = (locs ?? []) as { id: string; code: string; name: string }[];
      setLocations(locList);

      // Pilih lokasi kirim default sesuai status_aset item yang belum terkirim.
      if (!shipLocation && locList.length > 0) {
        const firstPending = its.find(
          (x) => (x.qty_approved ?? 0) - (x.qty_shipped ?? 0) > 0 && x.item_status !== "ditolak"
        );
        const asetUpper = (firstPending?.status_aset ?? its[0]?.status_aset ?? "").toUpperCase();
        const targetCode = asetUpper.includes("RETUR")
          ? "STOK-RETUR"
          : asetUpper.includes("UNREADY")
            ? "STOK-UNREADY"
            : "STOK-BARU";
        const defLoc = locList.find((l) => l.code.toUpperCase() === targetCode) ?? locList[0];
        if (defLoc) setShipLocation(defLoc.id);
      }

      // Prefill state.
      const a: Record<string, string> = {};
      const p: Record<string, { barcode: string; sn: string; type: string }> = {};
      const q: Record<string, string> = {};
      for (const x of its) {
        a[x.id] = x.qty_approved != null ? String(x.qty_approved) : String(x.qty_requested);
        p[x.id] = {
          barcode: x.barcode ?? "",
          sn: x.serial_number ?? "",
          type: x.item_type ?? "",
        };
        const sisa = (x.qty_approved ?? 0) - (x.qty_shipped ?? 0);
        q[x.id] = sisa > 0 ? String(sisa) : "";
      }
      setApproved(a);
      setProc(p);
      setShipQty(q);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memuat permintaan.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const pendingItems = useMemo(
    () => items.filter((x) => (x.qty_approved ?? 0) - (x.qty_shipped ?? 0) > 0 && x.item_status !== "ditolak"),
    [items]
  );

  /**
   * Rincian stok untuk tiap baris yang akan dikirim: lokasi mana yang dipotong
   * (mengikuti Status Aset), saldo lokasi itu, total semua lokasi, dan sisa
   * kekurangan berdasarkan qty kirim yang sedang diisi.
   */
  const shipInfo = useMemo(() => {
    const info: Record<
      string,
      {
        aset: ExcelStatusAset;
        code: string;
        loc?: LocationRow;
        saldo: number;
        total: number;
        qty: number;
        kurang: number;
        breakdown: string;
        suggestedAset?: ExcelStatusAset;
      }
    > = {};
    for (const x of pendingItems) {
      const { aset, code, loc } = targetLocationOf(x, locations);
      const total = stock[x.item_id] ?? 0;
      const saldo = loc ? (stockByLoc[locKey(x.item_id, loc.id)] ?? 0) : 0;
      const sisa = (x.qty_approved ?? 0) - (x.qty_shipped ?? 0);
      const raw = shipQty[x.id];
      const parsed = raw === "" || raw == null ? sisa : Number(raw);
      const qty = Number.isFinite(parsed) ? parsed : sisa;
      const alt = bestAlternativeLocation(x.item_id, locations, stockByLoc, qty, loc?.id);
      info[x.id] = {
        aset,
        code,
        loc,
        saldo,
        total,
        qty,
        kurang: Math.max(0, qty - saldo),
        breakdown: stockBreakdown(x.item_id, locations, stockByLoc),
        suggestedAset: alt ? ASET_BY_LOCATION_CODE[alt.l.code.toUpperCase()] : undefined,
      };
    }
    return info;
  }, [pendingItems, locations, stock, stockByLoc, shipQty]);

  // Baris yang qty kirimnya melebihi saldo lokasi pemotong (akan ditolak DB).
  const shortLines = pendingItems.filter((x) => (shipInfo[x.id]?.kurang ?? 0) > 0);

  // ---------- REVIEW (admin gudang) ----------
  const submitReview = async (decision: "approve" | "reject") => {
    if (!req || !id) return;
    if (decision === "reject" && !rejectReason.trim()) {
      toast.error("Alasan penolakan wajib diisi.");
      return;
    }
    setBusy(true);
    try {
      if (decision === "reject") {
        const { error } = await supabase
          .from("requests")
          .update({
            status: "ditolak",
            reviewed_by: user?.id ?? null,
            reviewed_at: new Date().toISOString(),
            rejection_reason: rejectReason.trim(),
          })
          .eq("id", id);
        if (error) throw new Error(error.message);
        const { error: itemErr } = await supabase
          .from("request_items")
          .update({ item_status: "ditolak", qty_approved: 0 })
          .eq("request_id", id);
        if (itemErr) throw new Error(itemErr.message);
      } else {
        const plan = buildRequestReviewPlan(
          items.map((x) => ({ ...x, name: x.inventory_items?.name })),
          approved,
          warehouseNote,
        );
        for (const update of plan.updates) {
          const { error } = await supabase
            .from("request_items")
            .update(update.values)
            .eq("id", update.itemId);
          if (error) throw new Error(error.message);
        }
        if (plan.pendingStockInserts.length > 0) {
          const { error } = await supabase.from("request_items").insert(plan.pendingStockInserts);
          if (error) throw new Error(error.message);
        }
        const { error } = await supabase
          .from("requests")
          .update({
            status: plan.requestStatus,
            reviewed_by: user?.id ?? null,
            reviewed_at: new Date().toISOString(),
          })
          .eq("id", id);
        if (error) throw new Error(error.message);
        toast.success(
          plan.requestStatus === "disetujui"
            ? "Permintaan disetujui penuh."
            : "Review tersimpan — item yang belum tersedia masuk Menunggu Stok / Sisa Belum Terkirim."
        );
      }
      await load();
      setShowReject(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan review.");
    } finally {
      setBusy(false);
    }
  };

  // Pulihkan item qty 0 yang ditolak oleh alur review lama karena stok kosong.
  const restoreRejectedZeroItem = async () => {
    if (!req || !restoreStockItem) return;
    const note = restoreStockNote.trim();
    if (!note) {
      toast.error("Keterangan gudang wajib diisi.");
      return;
    }
    if (!canRecoverZeroQtyItem(restoreStockItem, req)) {
      toast.error("Item ini tidak lagi memenuhi syarat untuk dipulihkan. Muat ulang tiket.");
      setRestoreStockItem(null);
      return;
    }

    setBusy(true);
    try {
      const { data: changedItem, error: itemError } = await supabase
        .from("request_items")
        .update({
          qty_approved: null,
          item_status: "menunggu_stok",
          notes: withWaitingStockNote(restoreStockItem.notes, note),
          updated_at: new Date().toISOString(),
        })
        .eq("id", restoreStockItem.id)
        .eq("request_id", req.id)
        .eq("item_status", "ditolak")
        .eq("qty_approved", 0)
        .select("id")
        .maybeSingle();
      if (itemError) throw new Error(itemError.message);
      if (!changedItem) throw new Error("Data item sudah berubah. Muat ulang tiket lalu coba lagi.");

      const now = new Date().toISOString();
      const { error: requestError } = await supabase
        .from("requests")
        .update({
          status: "disetujui_sebagian",
          reviewed_by: user?.id ?? req.reviewed_by,
          reviewed_at: now,
          updated_at: now,
          ...(req.status === "ditolak" ? { rejection_reason: null } : {}),
        })
        .eq("id", req.id);
      if (requestError) throw new Error(requestError.message);

      toast.success("Item dipulihkan ke Menunggu Stok dan akan tampil di Sisa Belum Terkirim.");
      setRestoreStockItem(null);
      setRestoreStockNote("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memulihkan item.");
    } finally {
      setBusy(false);
    }
  };

  // Setujui item yang menunggu stok (stok sudah datang).
  const approvePendingStock = async (itemId: string, qty: number) => {
    if (!window.confirm(`Setujui ${fmt(qty)} unit yang menunggu stok?`)) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("request_items")
        .update({ qty_approved: qty, item_status: "disetujui", updated_at: new Date().toISOString() })
        .eq("id", itemId);
      if (error) throw new Error(error.message);
      if (req && ["selesai", "ditolak", "diajukan"].includes(req.status)) {
        const { error: reqErr } = await supabase
          .from("requests")
          .update({ status: "disetujui_sebagian", updated_at: new Date().toISOString() })
          .eq("id", req.id);
        if (reqErr) throw new Error(reqErr.message);
      }
      toast.success("Item disetujui — siap diproses helper.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyetujui.");
    } finally {
      setBusy(false);
    }
  };

  // ---------- PROSES (helper) ----------
  const saveProcessItem = async (itemId: string, markReady: boolean) => {
    const p = proc[itemId];
    if (!p) return;
    if (!p.barcode.trim()) {
      toast.error("Barcode wajib diisi.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase
        .from("request_items")
        .update({
          barcode: p.barcode.trim(),
          serial_number: p.sn.trim() || null,
          item_type: p.type.trim() || null,
          item_status: markReady ? "siap" : "diproses",
          processed_by: user?.id ?? null,
        })
        .eq("id", itemId);
      if (error) throw new Error(error.message);
      if (req && ["disetujui", "disetujui_sebagian"].includes(req.status)) {
        await supabase.from("requests").update({ status: "diproses" }).eq("id", req.id);
      }
      toast.success(markReady ? "Item ditandai siap kirim." : "Proses item disimpan.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan.");
    } finally {
      setBusy(false);
    }
  };

  // Simpan semua baris yang sudah terisi barcode sekaligus (mode cepat Helper).
  const saveAllProcessItems = async () => {
    const processable = items.filter((x) =>
      ["disetujui", "diproses", "siap", "pending_sebagian"].includes(x.item_status)
    );
    const filled = processable.filter((x) => (proc[x.id]?.barcode ?? "").trim().length > 0);
    if (filled.length === 0) {
      toast.error("Isi minimal satu barcode terlebih dahulu.");
      return;
    }
    setBusy(true);
    try {
      for (const x of filled) {
        const p = proc[x.id];
        const { error } = await supabase
          .from("request_items")
          .update({
            barcode: p.barcode.trim(),
            serial_number: p.sn.trim() || null,
            item_type: p.type.trim() || null,
            item_status: "siap",
            processed_by: user?.id ?? null,
          })
          .eq("id", x.id);
        if (error) throw new Error(error.message);
      }
      if (req && ["disetujui", "disetujui_sebagian"].includes(req.status)) {
        await supabase.from("requests").update({ status: "diproses" }).eq("id", req.id);
      }
      toast.success(`${filled.length} item berhasil disimpan & ditandai Siap Kirim.`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan semua item.");
    } finally {
      setBusy(false);
    }
  };

  // ---------- KIRIM (admin gudang) ----------
  const submitShip = async () => {
    if (!req || !id) return;
    if (!shipLocation) {
      toast.error("Pilih lokasi gudang pengirim.");
      return;
    }
    const lines = pendingItems
      .map((x) => ({
        request_item_id: x.id,
        qty: Number(shipQty[x.id] || 0),
        resi: (shipResi[x.id] || "").trim(),
      }))
      .filter((l) => l.qty > 0);
    if (lines.length === 0) {
      toast.error("Isi qty kirim minimal satu item.");
      return;
    }
    for (const l of lines) {
      const x = pendingItems.find((p) => p.id === l.request_item_id)!;
      const sisa = (x.qty_approved ?? 0) - (x.qty_shipped ?? 0);
      if (l.qty > sisa) {
        toast.error(`Qty kirim "${x.inventory_items?.name}" melebihi sisa ${fmt(sisa)}.`);
        return;
      }
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("ship_request_items", {
        p_request_id: id,
        p_location_id: shipLocation,
        p_lines: lines,
        p_notes: `Pengiriman ${req.request_number} ke ${req.branch_name}`,
      });
      if (error) throw new Error(error.message);
      toast.success(`Berhasil dikirim. Transaksi tercatat (ID: ${String(data).slice(0, 8)}…).`);
      await load();
    } catch (e) {
      toast.error(
        formatShipError(e instanceof Error ? e.message : "Gagal mengirim.", {
          items,
          locations,
          stock,
          stockByLoc,
        })
      );
    } finally {
      setBusy(false);
    }
  };

  const handlePrint = (mode: "picklist" | "surat_jalan") => {
    setPrintMode(mode);
    setTimeout(() => window.print(), 50);
  };

  // Buka dialog edit item (superadmin).
  const openItemEdit = (x: RequestItem) => {
    const snList: string[] = [];
    const srList: string[] = [];
    const ketList: string[] = [];
    for (const n of (x.notes ?? "").split("\n")) {
      for (const p of n.split("|").map((s) => s.trim())) {
        const ketM = p.match(/^Ket:\s*(.+)$/i);
        const srM = p.match(/^Status request:\s*(.+)$/i);
        if (ketM) snList.push(ketM[1].trim());
        else if (srM) srList.push(srM[1].trim());
        else if (p) ketList.push(p);
      }
    }
    if (snList.length === 0 && x.serial_number) {
      for (const s of x.serial_number.split("\n").map((v) => v.trim()).filter(Boolean)) {
        snList.push(s);
      }
    }
    setEditItem(x);
    setEItemId(x.item_id);
    setEBarcode(x.barcode ?? "");
    setESn(snList.join("\n"));
    setEResi(x.resi ?? "");
    const parsedReq = parseRequestStatus([...new Set(srList)].join(", "));
    setEStatusReq(parsedReq.status);
    setEDurasiPinjam(parsedReq.durasi);
    setEStatusAset(parseStatusAset(x.status_aset));
    setEKet(ketList.join("\n"));
  };

  const saveItemEdit = async () => {
    if (!editItem) return;
    setESaving(true);
    try {
      // Rekonstruksi notes: "Ket: <SN>" per baris + "Status request: <SR>".
      const notesLines: string[] = [];
      const snValues = eSn.split("\n").map((v) => v.trim()).filter(Boolean);
      for (const s of snValues) {
        notesLines.push(`Ket: ${s}`);
      }
      notesLines.push(
        `Status request: ${formatRequestStatus({ status: eStatusReq, durasi: eDurasiPinjam })}`
      );
      for (const k of eKet.split("\n").map((v) => v.trim()).filter(Boolean)) {
        notesLines.push(k);
      }

      // Kolom non-kunci; item_id & status_aset ditangani khusus di bawah.
      const restFields = {
        barcode: eBarcode.trim() || null,
        serial_number: snValues.join("\n") || null,
        resi: eResi.trim() || null,
        notes: notesLines.join("\n") || null,
        updated_at: new Date().toISOString(),
      };

      const newItemId = eItemId || editItem.item_id;
      const oldStatus = parseStatusAset(editItem.status_aset);
      const qtyShipped = Number(editItem.qty_shipped ?? 0);
      const change = {
        oldItemId: editItem.item_id,
        newItemId,
        oldStatus,
        newStatus: eStatusAset,
        qtyShipped,
      };

      if (needsStockMove(change)) {
        // Baris sudah terkirim: stok WAJIB ikut dipindahkan, kalau tidak barang
        // lama menyimpan saldo minus walau tiketnya sudah diganti.
        const oldName = editItem.inventory_items?.name ?? "barang lama";
        const newName = masterItems.find((m) => m.id === newItemId)?.name ?? oldName;
        if (
          !window.confirm(
            describeItemChange({ ...change, oldName, newName })
          )
        ) {
          setESaving(false);
          return;
        }
        const { data, error } = await supabase.rpc("admin_change_request_item", {
          p_request_item_id: editItem.id,
          p_new_item_id: newItemId,
          p_new_status_aset: eStatusAset,
          p_reason: `Ubah dari tiket ${req?.ticket_no ?? req?.request_number ?? ""}`.trim(),
        });
        if (error) {
          if (isMissingRpcError(error.message)) {
            throw new Error(
              "Fitur koreksi stok belum aktif di database. Jalankan docs/sql/admin_change_request_item.sql di Supabase SQL Editor, lalu ulangi."
            );
          }
          throw new Error(error.message);
        }
        const { error: restErr } = await supabase
          .from("request_items")
          .update(restFields)
          .eq("id", editItem.id);
        if (restErr) throw new Error(restErr.message);
        toast.success(formatStockMoveResult(data, newName));
      } else {
        // Belum ada pengiriman (atau tidak ada perubahan barang/status):
        // cukup update baris seperti sebelumnya.
        const { error } = await supabase
          .from("request_items")
          .update({
            item_id: newItemId,
            status_aset: eStatusAset,
            ...restFields,
          })
          .eq("id", editItem.id);
        if (error) throw new Error(error.message);
        toast.success("Data item diperbarui.");
      }
      setEditItem(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan.");
    } finally {
      setESaving(false);
    }
  };

  // Hapus SATU baris Item Permintaan (khusus Super Admin, status apa pun).
  // Baris terkirim -> RPC mengembalikan stok sebagai transaksi IN koreksi;
  // baris belum terkirim -> hapus polos tanpa efek stok.
  const deleteItemEdit = async () => {
    if (!editItem || !isSuperAdmin) return;
    const name = editItem.inventory_items?.name ?? "barang";
    if (items.length <= 1) {
      toast.error(
        "Ini baris terakhir permintaan. Untuk membuang seluruh tiket, hapus permintaannya dari menu Permintaan."
      );
      return;
    }
    const qty = Number(editItem.qty_shipped ?? 0);
    const { code } = targetLocationOf(editItem, locations);
    if (!window.confirm(describeItemDelete({ name, qtyShipped: qty, locationCode: code }))) {
      return;
    }
    setEDeleting(true);
    try {
      const { data, error } = await supabase.rpc("admin_delete_request_item", {
        p_request_item_id: editItem.id,
        p_reason: `Hapus baris dari tiket ${req?.ticket_no ?? req?.request_number ?? ""}`.trim(),
      });
      if (error) {
        if (isMissingRpcError(error.message)) {
          throw new Error(
            "Fitur hapus item belum aktif di database. Jalankan docs/sql/admin_delete_request_item.sql di Supabase SQL Editor, lalu ulangi."
          );
        }
        throw new Error(error.message);
      }
      toast.success(formatDeleteItemResult(data, name));
      setEditItem(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menghapus baris.");
    } finally {
      setEDeleting(false);
    }
  };

  // Split 1 baris item (qty N) menjadi N baris @1 satuan,
  // supaya tiap satuan punya barcode/SN/resi sendiri.
  const [splitting, setSplitting] = useState(false);
  const splitItemRow = async (x: RequestItem) => {
    const n = Math.round(Number(x.qty_approved ?? x.qty_requested ?? 0));
    if (n <= 1) return;
    if (Number(x.qty_shipped ?? 0) > 0) {
      toast.error("Item sudah ada yang terkirim — tidak bisa di-split.");
      return;
    }
    const itemName = x.inventory_items?.name ?? "barang";
    if (!window.confirm(`Split "${itemName}" menjadi ${n} baris (1 per satuan)?`)) return;
    setSplitting(true);
    try {
      // Pecah nilai yang sudah terisi (satu per baris) ke tiap satuan.
      const barcodeLines = (x.barcode ?? "").split("\n").map((s) => s.trim());
      const resiLines = (x.resi ?? "").split("\n").map((s) => s.trim());
      const snLines: string[] = [];
      const otherNoteLines: string[] = [];
      for (const ln of (x.notes ?? "").split("\n")) {
        const m = ln.match(/^Ket:\s*(.+)$/i);
        if (m) snLines.push(m[1].trim());
        else if (ln.trim()) otherNoteLines.push(ln.trim());
      }
      if (snLines.length === 0 && x.serial_number) {
        for (const s of x.serial_number.split("\n").map((v) => v.trim()).filter(Boolean)) {
          snLines.push(s);
        }
      }
      const sharedNotes = otherNoteLines.join("\n") || null;
      const notesFor = (i: number) => {
        const parts: string[] = [];
        if (snLines[i]) parts.push(`Ket: ${snLines[i]}`);
        if (sharedNotes) parts.push(sharedNotes);
        return parts.join("\n") || null;
      };
      // Baris pertama: update baris asli jadi qty 1.
      const { error: updErr } = await supabase
        .from("request_items")
        .update({
          qty_requested: 1,
          qty_approved: x.qty_approved != null ? 1 : null,
          barcode: barcodeLines[0] || null,
          serial_number: snLines[0] || null,
          resi: resiLines[0] || null,
          notes: notesFor(0),
          updated_at: new Date().toISOString(),
        })
        .eq("id", x.id);
      if (updErr) throw new Error(updErr.message);
      // Baris 2..N: insert baris baru qty 1.
      const rows = [];
      for (let i = 1; i < n; i++) {
        rows.push({
          request_id: x.request_id,
          item_id: x.item_id,
          qty_requested: 1,
          qty_approved: x.qty_approved != null ? 1 : null,
          qty_shipped: 0,
          barcode: barcodeLines[i] || null,
          serial_number: snLines[i] || null,
          resi: resiLines[i] || null,
          item_type: x.item_type,
          status_aset: x.status_aset,
          item_status: x.item_status,
          notes: notesFor(i),
        });
      }
      if (rows.length > 0) {
        const { error: insErr } = await supabase.from("request_items").insert(rows);
        if (insErr) throw new Error(insErr.message);
      }
      toast.success(`"${itemName}" di-split menjadi ${n} baris.`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal split item.");
    } finally {
      setSplitting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-96" />
        </div>
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }
  if (!req) {
    return (
      <EmptyState
        title="Permintaan tidak ditemukan"
        description="Permintaan ini mungkin sudah dihapus atau Anda tidak memiliki akses."
      />
    );
  }

  const hasProcessableItems = items.some((x) =>
    ["disetujui", "diproses", "siap", "pending_sebagian"].includes(x.item_status)
  );
  const isReviewable = canReview && req.status === "diajukan";
  const isProcessable =
    canProcess &&
    (["disetujui", "disetujui_sebagian", "diproses"].includes(req.status) || hasProcessableItems);
  const isShippable =
    canReview &&
    (["disetujui", "disetujui_sebagian", "diproses"].includes(req.status) || pendingItems.length > 0);

  return (
    <div>
      <PageHeader
        title={req.ticket_no || req.request_number}
        description={`${req.request_number} • ${req.branch_name}${req.branch_code ? ` (${req.branch_code})` : ""} • ${req.request_date}`}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button variant="outline" size="sm" onClick={() => handlePrint("picklist")}>
              <Printer className="mr-1 h-4 w-4" /> Pick List
            </Button>
            <Button variant="outline" size="sm" onClick={() => handlePrint("surat_jalan")}>
              <Printer className="mr-1 h-4 w-4" /> Cetak Surat Jalan
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/permintaan")}>
              Kembali
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge variant={STATUS_VARIANT[req.status]}>{REQUEST_STATUS_LABELS[req.status]}</Badge>
        {req.status === "ditolak" && req.rejection_reason && (
          <span className="text-sm text-brand-600">Alasan: {req.rejection_reason}</span>
        )}
        {req.notes && <span className="text-sm text-ink-500">Catatan: {req.notes}</span>}
      </div>

      {/* ===== PANEL REVIEW (Admin Gudang) ===== */}
      {isReviewable && (
        <Card className="mb-4 border-info-100">
          <CardHeader>
            <CardTitle className="font-display text-base text-ink-800">
              Review Admin Gudang — cek stok & tentukan qty yang disetujui
            </CardTitle>
            <p className="mt-1 text-xs text-ink-500">
              Isi qty yang tersedia atau tekan Isi Sesuai Stok untuk mengisi otomatis berdasarkan Status Asset.
              Untuk barang yang stoknya kosong, tekan Tunggu Stok; qty 0 dan sisa persetujuan sebagian akan
              masuk menu Sisa Belum Terkirim. Tolak Semua hanya untuk seluruh tiket.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {items.map((x) => {
              const tersedia = stock[x.item_id] ?? 0;
              const minta = Number(x.qty_requested);
              const qtyDisetujui = Number(approved[x.id] ?? x.qty_requested);
              const targetReviewLocation = targetLocationOf(x, locations);
              const stokLokasiAset = targetReviewLocation.loc
                ? stockByLoc[locKey(x.item_id, targetReviewLocation.loc.id)] ?? 0
                : 0;
              const qtySesuaiStok = Math.max(0, Math.min(minta, stokLokasiAset));
              return (
                <div
                  key={x.id}
                  className="grid gap-3 rounded-lg border border-ink-200 bg-ink-50 p-3 sm:grid-cols-12 sm:items-end"
                >
                  <div className="sm:col-span-5">
                    <div className="font-medium">{x.inventory_items?.name}</div>
                    <div className="font-mono text-xs text-ink-500">{x.inventory_items?.sku}</div>
                    <div className="mt-1 text-xs">
                      <span className="text-ink-500">Minta: {fmt(minta)}</span>
                      {" • "}
                      <span className={tersedia >= minta ? "text-brand-700" : "text-warn-600"}>
                        Stok total: {fmt(tersedia)}
                        {stockBreakdown(x.item_id, locations, stockByLoc) &&
                          ` (${stockBreakdown(x.item_id, locations, stockByLoc)})`}
                      </span>
                      {" • "}
                      <span className={stokLokasiAset >= minta ? "text-brand-700" : "text-warn-600"}>
                        {targetReviewLocation.code}: {fmt(stokLokasiAset)}
                      </span>
                    </div>
                  </div>
                  <div className="sm:col-span-3">
                    <Label>Qty disetujui</Label>
                    <Input
                      type="number"
                      min="0"
                      value={approved[x.id] ?? ""}
                      onChange={(e) => setApproved((p) => ({ ...p, [x.id]: e.target.value }))}
                    />
                    <div className="mt-2 flex flex-wrap gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setApproved((p) => ({ ...p, [x.id]: String(qtySesuaiStok) }))
                        }
                      >
                        Isi Sesuai Stok
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setApproved((p) => ({ ...p, [x.id]: "0" }))}
                      >
                        <Hourglass className="mr-1 h-3.5 w-3.5" /> Tunggu Stok
                      </Button>
                    </div>
                  </div>
                  <div className="sm:col-span-4 text-xs text-ink-500">
                    {qtyDisetujui === 0
                      ? "Qty 0 akan masuk Menunggu Stok / Sisa Belum Terkirim, bukan ditolak."
                      : tersedia < minta
                        ? `Stok kurang ${fmt(minta - tersedia)} — sisa qty otomatis masuk Sisa Belum Terkirim.`
                        : "Stok cukup untuk permintaan penuh."}
                  </div>
                </div>
              );
            })}
            <div className="space-y-1.5 pt-2">
              <Label>Keterangan Gudang <span className="text-ink-500">(wajib bila ada qty menunggu stok)</span></Label>
              <Textarea
                rows={2}
                value={warehouseNote}
                onChange={(e) => setWarehouseNote(e.target.value)}
                placeholder="cth: stok gudang hanya 3, sisanya menunggu kiriman"
                className="text-sm"
              />
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button onClick={() => submitReview("approve")} disabled={busy}>
                <CheckCircle2 className="mr-1 h-4 w-4" /> Setujui
              </Button>
              <Button variant="destructive" onClick={() => setShowReject((v) => !v)} disabled={busy}>
                <XCircle className="mr-1 h-4 w-4" /> Tolak Semua
              </Button>
            </div>
            {showReject && (
              <div className="space-y-2 rounded-lg border border-brand-200 p-3">
                <Label>Alasan penolakan</Label>
                <Textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="cth: stok kosong untuk semua item…"
                  rows={2}
                />
                <Button variant="destructive" size="sm" onClick={() => submitReview("reject")} disabled={busy}>
                  Konfirmasi Tolak
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ===== PANEL SETUJUI MENUNGGU STOK ===== */}
      {canReview && items.some((x) => x.item_status === "menunggu_stok") && (
        <Card className="mb-4 border-info-100">
          <CardHeader>
            <CardTitle className="font-display text-base text-ink-800">
              Menunggu Stok — setujui saat stok sudah datang
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {items
              .filter((x) => x.item_status === "menunggu_stok")
              .map((x) => (
                <div
                  key={x.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-200 bg-ink-50 p-3"
                >
                  <div>
                    <div className="font-medium">{x.inventory_items?.name}</div>
                    <div className="text-xs text-ink-500">
                      Qty: {fmt(Number(x.qty_requested))}
                      {x.notes && <span className="ml-2 text-info-600">• {x.notes}</span>}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => approvePendingStock(x.id, Number(x.qty_requested))}
                    disabled={busy}
                  >
                    <CheckCircle2 className="mr-1 h-4 w-4" /> Setujui {fmt(Number(x.qty_requested))}
                  </Button>
                </div>
              ))}
          </CardContent>
        </Card>
      )}

      {/* ===== PANEL PROSES (Helper) ===== */}
      {isProcessable && (
        <Card className="mb-4 border-warn-100 print:hidden">
          <CardHeader>
            <div>
              <CardTitle className="font-display text-base text-ink-800">
                Proses Helper — isi barcode/SN lalu tandai siap
              </CardTitle>
              <p className="mt-0.5 text-xs text-ink-500">
                Tips scanner USB: tekan Enter setelah scan Barcode untuk otomatis pindah ke kolom SN / baris berikutnya.
              </p>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {items
              .filter((x) => ["disetujui", "diproses", "siap", "pending_sebagian"].includes(x.item_status))
              .map((x, idx, arr) => {
                const p = proc[x.id] ?? { barcode: "", sn: "", type: "" };
                const nextId = arr[idx + 1]?.id;
                return (
                  <div
                    key={x.id}
                    className="grid gap-3 rounded-lg border border-ink-200 bg-ink-50 p-3 sm:grid-cols-12 sm:items-end"
                  >
                    <div className="sm:col-span-4">
                      <div className="font-medium">{x.inventory_items?.name}</div>
                      <div className="text-xs text-ink-500">
                        Qty disetujui: {fmt(Number(x.qty_approved ?? 0))}
                        {x.status_aset && <span className="ml-2 text-info-600">• {x.status_aset}</span>}
                      </div>
                    </div>
                    <div className="sm:col-span-3">
                      <Label>Barcode (wajib)</Label>
                      <Input
                        id={`proc-bc-${x.id}`}
                        value={p.barcode}
                        onChange={(e) =>
                          setProc((prev) => ({ ...prev, [x.id]: { ...p, barcode: e.target.value } }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            const snEl = document.getElementById(`proc-sn-${x.id}`);
                            snEl?.focus();
                          }
                        }}
                        placeholder="Scan / ketik barcode"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Label>SN (opsional)</Label>
                      <Input
                        id={`proc-sn-${x.id}`}
                        value={p.sn}
                        onChange={(e) =>
                          setProc((prev) => ({ ...prev, [x.id]: { ...p, sn: e.target.value } }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            if (nextId) {
                              document.getElementById(`proc-bc-${nextId}`)?.focus();
                            }
                          }
                        }}
                        placeholder="Serial number"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Label>Type barang</Label>
                      <Input
                        value={p.type}
                        onChange={(e) =>
                          setProc((prev) => ({ ...prev, [x.id]: { ...p, type: e.target.value } }))
                        }
                        placeholder="cth: Elektronik"
                      />
                    </div>
                    <div className="flex gap-1 sm:col-span-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => saveProcessItem(x.id, false)}
                        disabled={busy}
                        title="Simpan"
                      >
                        Simpan
                      </Button>
                    </div>
                    <div className="sm:col-span-12">
                      <Button
                        size="sm"
                        onClick={() => saveProcessItem(x.id, true)}
                        disabled={busy || x.item_status === "siap"}
                      >
                        <PackageCheck className="mr-1 h-4 w-4" />
                        {x.item_status === "siap" ? "Sudah Siap" : "Tandai Siap Kirim"}
                      </Button>
                    </div>
                  </div>
                );
              })}

            {/* Tombol aksi di bawah kiri: daftar item bisa panjang, jadi tombol
                wajib dekat baris terakhir yang sedang diisi helper. */}
            <div className="flex justify-start pt-1">
              <Button onClick={saveAllProcessItems} disabled={busy}>
                <CheckCircle2 className="mr-1 h-4 w-4" /> Simpan Semua & Siap Kirim
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===== PANEL KIRIM (Admin Gudang) ===== */}
      {isShippable && pendingItems.length > 0 && (
        <Card className="mb-4 border-brand-200">
          <CardHeader>
            <CardTitle className="font-display text-base text-ink-800">
              Kirim Barang — catat qty kirim & no resi
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Lokasi gudang pengirim</Label>
                <select
                  value={shipLocation}
                  onChange={(e) => setShipLocation(e.target.value)}
                  className="w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-800"
                >
                  <option value="">— Pilih lokasi —</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.code} — {l.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-ink-500">
                  Lokasi pemotongan stok mengikuti Status Aset tiap baris: ASSET BARU →{" "}
                  <span className="font-mono">STOK-BARU</span>, ASSET RETUR →{" "}
                  <span className="font-mono">STOK-RETUR</span>, UNREADY →{" "}
                  <span className="font-mono">STOK-UNREADY</span>.
                </p>
              </div>
            </div>
            {shortLines.length > 0 && (
              <div className="rounded-lg border border-warn-100 bg-warn-50 p-3 text-sm text-warn-700">
                <div className="font-semibold">
                  {shortLines.length} baris belum bisa dikirim: saldo lokasi pemotong kurang.
                </div>
                <p className="mt-1 text-xs">
                  Angka di menu Persediaan adalah TOTAL semua lokasi, sedangkan pengiriman hanya
                  memotong satu lokasi sesuai Status Aset. Ikuti saran pada baris yang ditandai di
                  bawah.
                </p>
              </div>
            )}
            {pendingItems.map((x) => {
              const sisa = (x.qty_approved ?? 0) - (x.qty_shipped ?? 0);
              const info = shipInfo[x.id];
              const kurang = info?.kurang ?? 0;
              return (
                <div
                  key={x.id}
                  className={`grid gap-3 rounded-lg border p-3 sm:grid-cols-12 sm:items-end ${
                    kurang > 0 ? "border-warn-100 bg-warn-50" : "border-ink-200 bg-ink-50"
                  }`}
                >
                  <div className="sm:col-span-5">
                    <div className="font-medium">{x.inventory_items?.name}</div>
                    <div className="text-xs text-ink-500">
                      Sisa: {fmt(sisa)} • Terkirim: {fmt(Number(x.qty_shipped ?? 0))}
                      {x.barcode && <span className="font-mono"> • {x.barcode}</span>}
                    </div>
                    <div className="mt-1 text-xs">
                      <span className="text-ink-500">Stok total: {fmt(info?.total ?? 0)}</span>
                      {" • "}
                      <span className={kurang > 0 ? "text-warn-600" : "text-brand-700"}>
                        Saldo {info?.code ?? "—"}: {fmt(info?.saldo ?? 0)}
                      </span>
                      {info?.breakdown && (
                        <span className="text-ink-500"> ({info.breakdown})</span>
                      )}
                    </div>
                    {kurang > 0 && (
                      <div className="mt-2 rounded-md border border-warn-100 bg-white p-2 text-xs text-warn-700">
                        Qty kirim {fmt(info?.qty ?? 0)} melebihi saldo {info?.code} sebesar{" "}
                        {fmt(kurang)}.{" "}
                        {info?.suggestedAset
                          ? `Stok ada di lokasi lain — ubah Status Aset baris ini ke ${info.suggestedAset} (Edit Item, Super Admin), atau pindahkan stoknya ke ${info.code}.`
                          : `Pindahkan stok dari lokasi lain ke ${info?.code} (Transfers/Stock Opname), atau kurangi qty kirim.`}
                      </div>
                    )}
                  </div>
                  <div className="sm:col-span-2">
                    <Label>Qty kirim</Label>
                    <Input
                      type="number"
                      min="0"
                      value={shipQty[x.id] ?? ""}
                      onChange={(e) => setShipQty((p) => ({ ...p, [x.id]: e.target.value }))}
                    />
                  </div>
                  <div className="sm:col-span-5">
                    <Label>No resi</Label>
                    <Input
                      value={shipResi[x.id] ?? ""}
                      onChange={(e) => setShipResi((p) => ({ ...p, [x.id]: e.target.value }))}
                      placeholder="No resi pengiriman"
                    />
                  </div>
                </div>
              );
            })}
            <Button onClick={submitShip} disabled={busy}>
              <Send className="mr-1 h-4 w-4" /> Kirim & Catat Transaksi
            </Button>
            <p className="text-xs text-ink-500">
              Pengiriman otomatis mencatat transaksi barang keluar — stok berkurang dan tercatat di
              buku besar.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ===== DAFTAR ITEM ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-base text-ink-800">Item Permintaan</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-ink-50">
                <tr className="border-b border-ink-200 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
                  <th className="pb-2 pr-3">Item</th>
                  <th className="pb-2 pr-3 text-right">Request</th>
                  <th className="pb-2 pr-3 text-right">Disetujui</th>
                  <th className="pb-2 pr-3 text-right">Terkirim</th>
                  <th className="pb-2 pr-3">Barcode</th>
                  <th className="pb-2 pr-3">SN</th>
                  <th className="pb-2 pr-3">Resi</th>
                  <th className="pb-2 pr-3">Status Request</th>
                  <th className="pb-2 pr-3">Status Asset</th>
                  <th className="pb-2 pr-3">Keterangan</th>
                  {(isSuperAdmin || canReview) && <th className="pb-2">Aksi</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((x) => {
                  // Parse notes: "Ket: <SN> | Status request: <SR>" per baris.
                  const snList: string[] = [];
                  const srList: string[] = [];
                  const ketList: string[] = [];
                  for (const n of (x.notes ?? "").split("\n")) {
                    const parts = n.split("|").map((s) => s.trim());
                    for (const p of parts) {
                      const ketM = p.match(/^Ket:\s*(.+)$/i);
                      const srM = p.match(/^Status request:\s*(.+)$/i);
                      if (ketM) {
                        snList.push(ketM[1].trim());
                      } else if (srM) {
                        srList.push(srM[1].trim());
                      } else if (p) {
                        ketList.push(p);
                      }
                    }
                  }
                  if (snList.length === 0 && x.serial_number) {
                    for (const s of x.serial_number.split("\n").map((v) => v.trim()).filter(Boolean)) {
                      snList.push(s);
                    }
                  }
                  return (
                  <tr key={x.id} className="border-b border-ink-200 transition-colors hover:bg-brand-50/40">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{x.inventory_items?.name}</div>
                      <div className="font-mono text-xs text-ink-500">{x.inventory_items?.sku}</div>
                    </td>
                    <td className="tnum py-2 pr-3 text-right">{fmt(Number(x.qty_requested))}</td>
                    <td className="tnum py-2 pr-3 text-right">
                      {x.qty_approved != null ? fmt(Number(x.qty_approved)) : "—"}
                    </td>
                    <td className="tnum py-2 pr-3 text-right">{fmt(Number(x.qty_shipped))}</td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {x.barcode ? (
                        <div className="space-y-0.5">
                          {x.barcode.split("\n").map((b, i) => (
                            <div key={i} className="text-ink-800">{b.trim()}</div>
                          ))}
                        </div>
                      ) : "—"}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {snList.length > 0 ? (
                        <div className="space-y-0.5">
                          {snList.map((s, i) => <div key={i} className="text-ink-800">{s}</div>)}
                        </div>
                      ) : "—"}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {x.resi ? (
                        <div className="space-y-0.5">
                          {x.resi.split("\n").map((r, i) => (
                            <div key={i} className="text-ink-800">{r.trim()}</div>
                          ))}
                        </div>
                      ) : "—"}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {srList.length > 0 ? (
                        <div className="space-y-0.5">
                          {[...new Set(srList)].map((s, i) => <div key={i} className="text-warn-700">{s}</div>)}
                        </div>
                      ) : (
                        <Badge variant={ITEM_VARIANT[x.item_status] ?? "default"}>
                          {REQUEST_ITEM_STATUS_LABELS[x.item_status]}
                        </Badge>
                      )}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {x.status_aset ? <span className="text-info-700">{x.status_aset}</span> : "—"}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {ketList.length > 0 ? (
                        <div className="space-y-0.5">
                          {ketList.map((k, i) => <div key={i} className="text-ink-500">{k}</div>)}
                        </div>
                      ) : "—"}
                    </td>
                    {(isSuperAdmin || canReview) && (
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1">
                          {isSuperAdmin && (
                            <>
                              {Math.round(Number(x.qty_approved ?? x.qty_requested ?? 0)) > 1 &&
                                Number(x.qty_shipped ?? 0) === 0 && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => splitItemRow(x)}
                                    disabled={splitting}
                                    title="Split menjadi 1 baris per satuan"
                                  >
                                    <Scissors className="mr-1 h-3 w-3" /> Split
                                  </Button>
                                )}
                              <Button variant="outline" size="sm" onClick={() => openItemEdit(x)}>
                                <Pencil className="mr-1 h-3 w-3" /> Edit
                              </Button>
                            </>
                          )}
                          {canReview && canRecoverZeroQtyItem(x, req) && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setRestoreStockItem(x);
                                setRestoreStockNote("");
                              }}
                            >
                              <Hourglass className="mr-1 h-3 w-3" /> Pulihkan ke Menunggu Stok
                            </Button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Dialog edit item (superadmin) */}
      <Dialog open={!!editItem} onOpenChange={(o) => !o && setEditItem(null)}>
        <DialogHeader>
          <DialogTitle>Edit — {editItem?.inventory_items?.name}</DialogTitle>
          <DialogDescription>
            Revisi data item. Satu nilai per baris untuk Barcode, SN, Resi, Keterangan.
            {Number(editItem?.qty_shipped ?? 0) > 0 && (
              <span className="mt-1 block text-warn-700">
                Baris ini sudah dikirim {fmt(Number(editItem?.qty_shipped ?? 0))} unit — mengubah
                Nama Barang atau Status Asset akan memindahkan stok {fmt(Number(editItem?.qty_shipped ?? 0))}{" "}
                unit tersebut ke barang/lokasi baru (tercatat sebagai transaksi koreksi).
              </span>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 px-1 py-2 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Nama Barang</Label>
            <select
              value={eItemId}
              onChange={(e) => setEItemId(e.target.value)}
              className="w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-800"
            >
              {masterItems.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Barcode (satu per baris)</Label>
            <Textarea rows={4} value={eBarcode} onChange={(e) => setEBarcode(e.target.value)} className="font-mono text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label>SN (satu per baris)</Label>
            <Textarea rows={4} value={eSn} onChange={(e) => setESn(e.target.value)} className="font-mono text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label>Resi (satu per baris)</Label>
            <Textarea rows={3} value={eResi} onChange={(e) => setEResi(e.target.value)} className="font-mono text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label>Keterangan (satu per baris)</Label>
            <Textarea rows={3} value={eKet} onChange={(e) => setEKet(e.target.value)} className="font-mono text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-status-request">Status Request</Label>
            <Select
              id="edit-status-request"
              value={eStatusReq}
              onValueChange={(v) => setEStatusReq(v as StatusRequest)}
              options={STATUS_REQUEST_OPTIONS.map((o) => ({
                value: o,
                label: STATUS_REQUEST_LABELS[o],
              }))}
            />
          </div>
          {eStatusReq === "PINJAM" && (
            <div className="space-y-1.5">
              <Label htmlFor="edit-durasi-pinjam">Durasi Pinjam</Label>
              <Input
                id="edit-durasi-pinjam"
                value={eDurasiPinjam}
                onChange={(e) => setEDurasiPinjam(e.target.value)}
                placeholder="cth: 1 MINGGU"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="edit-status-asset">Status Asset</Label>
            <Select
              id="edit-status-asset"
              value={eStatusAset}
              onValueChange={(v) => setEStatusAset(v as ExcelStatusAset)}
              options={(Object.keys(EXCEL_STATUS_ASET_LABELS) as ExcelStatusAset[]).map((o) => ({
                value: o,
                label: EXCEL_STATUS_ASET_LABELS[o],
              }))}
            />
            <p className="mt-1 text-xs text-ink-500">
              Stok dipotong dari <b>{EXCEL_STATUS_ASET_LOKASI[eStatusAset]}</b> saat barang terkirim.
            </p>
          </div>
        </div>
        <DialogFooter>
          {isSuperAdmin && (
            <Button
              variant="destructive"
              className="sm:mr-auto"
              onClick={deleteItemEdit}
              disabled={eSaving || eDeleting}
            >
              <Trash2 className="mr-1 h-4 w-4" /> {eDeleting ? "Menghapus…" : "Hapus Item"}
            </Button>
          )}
          <Button variant="outline" onClick={() => setEditItem(null)} disabled={eSaving || eDeleting}>
            Batal
          </Button>
          <Button onClick={saveItemEdit} disabled={eSaving || eDeleting}>
            {eSaving ? "Menyimpan…" : "Simpan"}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Pulihkan baris qty 0 lama yang keliru tertandai ditolak karena stok kosong. */}
      <Dialog
        open={!!restoreStockItem}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setRestoreStockItem(null);
            setRestoreStockNote("");
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Pulihkan — {restoreStockItem?.inventory_items?.name}</DialogTitle>
          <DialogDescription>
            Qty 0 dari review lama tersimpan sebagai ditolak. Jika penyebabnya stok kosong, ubah baris ini ke
            Menunggu Stok agar muncul di menu Sisa Belum Terkirim.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5 px-1 py-2">
          <Label htmlFor="restore-stock-note">Keterangan Gudang (wajib)</Label>
          <Textarea
            id="restore-stock-note"
            rows={3}
            value={restoreStockNote}
            onChange={(e) => setRestoreStockNote(e.target.value)}
            placeholder="cth: stok mouse kosong, menunggu restock"
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setRestoreStockItem(null)}
            disabled={busy}
          >
            Batal
          </Button>
          <Button onClick={restoreRejectedZeroItem} disabled={busy || !restoreStockNote.trim()}>
            {busy ? "Memulihkan…" : "Pulihkan ke Menunggu Stok"}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* ===== CETAK SURAT JALAN / PICK LIST (Hanya muncul saat Print) ===== */}
      <div className="mt-8 hidden border-t border-ink-200 pt-6 text-xs text-ink-700 print:block">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-base font-bold uppercase tracking-wide">
              {printMode === "surat_jalan" ? "SURAT JALAN PENGIRIMAN BARANG" : "PICK LIST GUDANG"}
            </h2>
            <p className="mt-1">
              No. Permintaan: <b>{req.request_number}</b> • No. Tiket: <b>{req.ticket_no || "—"}</b>
            </p>
            <p>
              Tujuan Cabang/Gerai: <b>{req.branch_name}</b>
              {req.branch_code ? ` (${req.branch_code})` : ""}
            </p>
          </div>
          <div className="text-right">
            <p>Tanggal Permintaan: {req.request_date}</p>
            <p>Tanggal Cetak: {new Date().toISOString().slice(0, 10)}</p>
          </div>
        </div>
        <div className="mt-10 grid grid-cols-3 gap-6 text-center">
          <div className="rounded border border-ink-200 p-3">
            <p className="font-semibold">Disiapkan Oleh (Helper Gudang)</p>
            <div className="h-16" />
            <p className="border-t border-ink-200 pt-1">( ........................................ )</p>
          </div>
          <div className="rounded border border-ink-200 p-3">
            <p className="font-semibold">Disetujui Oleh (Admin Gudang)</p>
            <div className="h-16" />
            <p className="border-t border-ink-200 pt-1">( ........................................ )</p>
          </div>
          <div className="rounded border border-ink-200 p-3">
            <p className="font-semibold">
              {printMode === "surat_jalan" ? "Diterima Oleh (Ekspedisi / Gerai)" : "Pemeriksa Gudang"}
            </p>
            <div className="h-16" />
            <p className="border-t border-ink-200 pt-1">( ........................................ )</p>
          </div>
        </div>
      </div>
    </div>
  );
}
