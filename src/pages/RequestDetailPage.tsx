import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, PackageCheck, Pencil, Printer, Scissors, Send, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import {
  REQUEST_STATUS_LABELS,
  REQUEST_ITEM_STATUS_LABELS,
  type Request,
  type RequestItem,
  type RequestStatus,
} from "../types/database";

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

interface StockMap {
  [itemId: string]: number;
}

// Ubah pesan error teknis (berisi UUID) menjadi bahasa yang mudah dipahami.
function formatShipError(raw: string, items: RequestItem[]): string {
  const m = raw.match(/Stok tidak mencukupi \(item ([0-9a-f-]{36})/i);
  if (m) {
    const found = items.find((x) => x.item_id === m[1]);
    const itemName = found?.inventory_items?.name ?? "barang";
    const avail = raw.match(/tersedia ([\d.,]+)/i)?.[1] ?? "?";
    const need = raw.match(/perubahan -([\d.,]+)/i)?.[1] ?? "?";
    return `Stok "${itemName}" tidak cukup (tersedia ${avail}, dibutuhkan ${need}). Tambah stok dulu di menu Persediaan.`;
  }
  return raw
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]")
    .trim() || "Gagal mengirim.";
}

export function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, hasPermission, isSuperAdmin } = useAuth();
  const [req, setReq] = useState<Request | null>(null);
  const [items, setItems] = useState<RequestItem[]>([]);
  const [stock, setStock] = useState<StockMap>({});
  const [locations, setLocations] = useState<{ id: string; code: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Edit item (superadmin) — revisi data per baris.
  const [editItem, setEditItem] = useState<RequestItem | null>(null);
  const [masterItems, setMasterItems] = useState<{ id: string; name: string }[]>([]);
  const [eItemId, setEItemId] = useState("");
  const [eBarcode, setEBarcode] = useState("");
  const [eSn, setESn] = useState("");
  const [eResi, setEResi] = useState("");
  const [eStatusReq, setEStatusReq] = useState("");
  const [eStatusAset, setEStatusAset] = useState("");
  const [eKet, setEKet] = useState("");
  const [eSaving, setESaving] = useState(false);

  // Review state (admin gudang)
  const [approved, setApproved] = useState<Record<string, string>>({});
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [warehouseNote, setWarehouseNote] = useState("");

  // Process state (helper)
  const [proc, setProc] = useState<Record<string, { barcode: string; sn: string; type: string }>>({});

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

      // Stok tersedia per barang (untuk panel review).
      const itemIds = its.map((x) => x.item_id);
      if (itemIds.length > 0) {
        const { data: bal } = await supabase
          .from("inventory_balances")
          .select("item_id, qty")
          .in("item_id", itemIds);
        const m: StockMap = {};
        for (const b of (bal ?? []) as { item_id: string; qty: number | string }[]) {
          m[b.item_id] = (m[b.item_id] ?? 0) + Number(b.qty);
        }
        setStock(m);
      }

      const { data: locs } = await supabase
        .from("locations")
        .select("id, code, name")
        .eq("is_active", true)
        .order("code")
        .limit(100);
      setLocations((locs ?? []) as { id: string; code: string; name: string }[]);

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
        await supabase.from("request_items").update({ item_status: "ditolak", qty_approved: 0 }).eq("request_id", id);
      } else {
        // Validasi qty approve per item.
        let needNote = false;
        for (const x of items) {
          const q = Number(approved[x.id]);
          if (!(q >= 0) || q > Number(x.qty_requested)) {
            throw new Error(`Qty setuju "${x.inventory_items?.name}" harus 0–${fmt(Number(x.qty_requested))}.`);
          }
          if (q > 0 && q < Number(x.qty_requested)) needNote = true;
        }
        if (needNote && !warehouseNote.trim()) {
          throw new Error("Keterangan gudang wajib diisi bila ada item yang disetujui sebagian.");
        }
        for (const x of items) {
          const q = Number(approved[x.id]);
          const minta = Number(x.qty_requested);
          if (q > 0 && q < minta) {
            // Approve sebagian: baris asli jadi qty yg disetujui,
            // sisanya jadi baris pending "menunggu_stok" + keterangan gudang.
            const sisaQty = minta - q;
            const { error: updErr } = await supabase
              .from("request_items")
              .update({
                qty_requested: q,
                qty_approved: q,
                item_status: "disetujui",
              })
              .eq("id", x.id);
            if (updErr) throw new Error(updErr.message);
            const { error: insErr } = await supabase.from("request_items").insert({
              request_id: x.request_id,
              item_id: x.item_id,
              qty_requested: sisaQty,
              qty_approved: null,
              qty_shipped: 0,
              item_status: "menunggu_stok",
              notes: `Menunggu stok: ${warehouseNote.trim()}`,
            });
            if (insErr) throw new Error(insErr.message);
          } else {
            const { error } = await supabase
              .from("request_items")
              .update({
                qty_approved: q,
                item_status: q > 0 ? "disetujui" : "ditolak",
              })
              .eq("id", x.id);
            if (error) throw new Error(error.message);
          }
        }
        const allFull = items.every((x) => Number(approved[x.id]) >= Number(x.qty_requested));
        const anyApproved = items.some((x) => Number(approved[x.id]) > 0);
        const status = !anyApproved ? "ditolak" : allFull ? "disetujui" : "disetujui_sebagian";
        const { error } = await supabase
          .from("requests")
          .update({
            status,
            reviewed_by: user?.id ?? null,
            reviewed_at: new Date().toISOString(),
          })
          .eq("id", id);
        if (error) throw new Error(error.message);
        toast.success(
          status === "disetujui"
            ? "Permintaan disetujui penuh."
            : status === "disetujui_sebagian"
              ? "Disetujui sebagian — sisa masuk dashboard Sisa Belum Terkirim."
              : "Permintaan ditolak (semua qty 0)."
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
      toast.error(formatShipError(e instanceof Error ? e.message : "Gagal mengirim.", items));
    } finally {
      setBusy(false);
    }
  };

  const handlePrint = () => window.print();

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
    setEditItem(x);
    setEItemId(x.item_id);
    setEBarcode(x.barcode ?? "");
    setESn(snList.join("\n"));
    setEResi(x.resi ?? "");
    setEStatusReq([...new Set(srList)].join(", "));
    setEStatusAset(x.status_aset ?? "");
    setEKet(ketList.join("\n"));
  };

  const saveItemEdit = async () => {
    if (!editItem) return;
    setESaving(true);
    try {
      // Rekonstruksi notes: "Ket: <SN>" per baris + "Status request: <SR>".
      const notesLines: string[] = [];
      for (const s of eSn.split("\n").map((v) => v.trim()).filter(Boolean)) {
        notesLines.push(`Ket: ${s}`);
      }
      if (eStatusReq.trim()) notesLines.push(`Status request: ${eStatusReq.trim()}`);
      for (const k of eKet.split("\n").map((v) => v.trim()).filter(Boolean)) {
        notesLines.push(k);
      }
      const { error } = await supabase
        .from("request_items")
        .update({
          item_id: eItemId || editItem.item_id,
          barcode: eBarcode.trim() || null,
          resi: eResi.trim() || null,
          status_aset: eStatusAset.trim() || null,
          notes: notesLines.join("\n") || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", editItem.id);
      if (error) throw new Error(error.message);
      toast.success("Data item diperbarui.");
      setEditItem(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan.");
    } finally {
      setESaving(false);
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

  if (loading) return <div className="text-sm text-slate-500">Memuat…</div>;
  if (!req) return <div className="text-sm text-slate-500">Permintaan tidak ditemukan.</div>;

  const isReviewable = canReview && req.status === "diajukan";
  const isProcessable =
    canProcess && ["disetujui", "disetujui_sebagian", "diproses"].includes(req.status);
  const isShippable =
    canReview && ["disetujui", "disetujui_sebagian", "diproses"].includes(req.status);

  return (
    <div>
      <PageHeader
        title={req.ticket_no || req.request_number}
        description={`${req.request_number} • ${req.branch_name}${req.branch_code ? ` (${req.branch_code})` : ""} • ${req.request_date}`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handlePrint}>
              <Printer className="mr-1 h-4 w-4" /> Pick List
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
          <span className="text-sm text-rose-300">Alasan: {req.rejection_reason}</span>
        )}
        {req.notes && <span className="text-sm text-slate-400">Catatan: {req.notes}</span>}
      </div>

      {/* ===== PANEL REVIEW (Admin Gudang) ===== */}
      {isReviewable && (
        <Card className="mb-4 border-sky-400/20">
          <CardHeader>
            <CardTitle className="font-display text-base text-white">
              Review Admin Gudang — cek stok & tentukan qty yang disetujui
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {items.map((x) => {
              const tersedia = stock[x.item_id] ?? 0;
              const minta = Number(x.qty_requested);
              return (
                <div
                  key={x.id}
                  className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-3 sm:grid-cols-12 sm:items-end"
                >
                  <div className="sm:col-span-5">
                    <div className="font-medium">{x.inventory_items?.name}</div>
                    <div className="font-mono text-xs text-slate-500">{x.inventory_items?.sku}</div>
                    <div className="mt-1 text-xs">
                      <span className="text-slate-400">Minta: {fmt(minta)}</span>
                      {" • "}
                      <span className={tersedia >= minta ? "text-brand-300" : "text-amber-300"}>
                        Stok tersedia: {fmt(tersedia)}
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
                  </div>
                  <div className="sm:col-span-4 text-xs text-slate-500">
                    {tersedia < minta
                      ? `Stok kurang ${fmt(minta - tersedia)} — setujui sebagian, sisa otomatis masuk Sisa Belum Terkirim.`
                      : "Stok cukup untuk permintaan penuh."}
                  </div>
                </div>
              );
            })}
            <div className="space-y-1.5 pt-2">
              <Label>Keterangan Gudang <span className="text-slate-500">(wajib bila ada yang disetujui sebagian)</span></Label>
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
              <div className="space-y-2 rounded-lg border border-rose-400/20 p-3">
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
        <Card className="mb-4 border-sky-400/20">
          <CardHeader>
            <CardTitle className="font-display text-base text-white">
              Menunggu Stok — setujui saat stok sudah datang
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {items
              .filter((x) => x.item_status === "menunggu_stok")
              .map((x) => (
                <div
                  key={x.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-3"
                >
                  <div>
                    <div className="font-medium">{x.inventory_items?.name}</div>
                    <div className="text-xs text-slate-500">
                      Qty: {fmt(Number(x.qty_requested))}
                      {x.notes && <span className="ml-2 text-sky-300">• {x.notes}</span>}
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
        <Card className="mb-4 border-amber-400/20">
          <CardHeader>
            <CardTitle className="font-display text-base text-white">
              Proses Helper — isi barcode/SN lalu tandai siap
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {items
              .filter((x) => ["disetujui", "diproses", "siap", "pending_sebagian"].includes(x.item_status))
              .map((x) => {
                const p = proc[x.id] ?? { barcode: "", sn: "", type: "" };
                return (
                  <div
                    key={x.id}
                    className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-3 sm:grid-cols-12 sm:items-end"
                  >
                    <div className="sm:col-span-4">
                      <div className="font-medium">{x.inventory_items?.name}</div>
                      <div className="text-xs text-slate-500">
                        Qty disetujui: {fmt(Number(x.qty_approved ?? 0))}
                      </div>
                    </div>
                    <div className="sm:col-span-3">
                      <Label>Barcode (wajib)</Label>
                      <Input
                        value={p.barcode}
                        onChange={(e) =>
                          setProc((prev) => ({ ...prev, [x.id]: { ...p, barcode: e.target.value } }))
                        }
                        placeholder="Scan / ketik barcode"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Label>SN (opsional)</Label>
                      <Input
                        value={p.sn}
                        onChange={(e) =>
                          setProc((prev) => ({ ...prev, [x.id]: { ...p, sn: e.target.value } }))
                        }
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
          </CardContent>
        </Card>
      )}

      {/* ===== PANEL KIRIM (Admin Gudang) ===== */}
      {isShippable && pendingItems.length > 0 && (
        <Card className="mb-4 border-brand-400/20">
          <CardHeader>
            <CardTitle className="font-display text-base text-white">
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
                  className="w-full rounded-md border border-white/10 bg-ink-900 px-3 py-2 text-sm text-slate-200"
                >
                  <option value="">— Pilih lokasi —</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.code} — {l.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {pendingItems.map((x) => {
              const sisa = (x.qty_approved ?? 0) - (x.qty_shipped ?? 0);
              return (
                <div
                  key={x.id}
                  className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-3 sm:grid-cols-12 sm:items-end"
                >
                  <div className="sm:col-span-5">
                    <div className="font-medium">{x.inventory_items?.name}</div>
                    <div className="text-xs text-slate-500">
                      Sisa: {fmt(sisa)} • Terkirim: {fmt(Number(x.qty_shipped ?? 0))}
                      {x.barcode && <span className="font-mono"> • {x.barcode}</span>}
                    </div>
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
            <p className="text-xs text-slate-500">
              Pengiriman otomatis mencatat transaksi barang keluar — stok berkurang dan tercatat di
              buku besar.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ===== DAFTAR ITEM ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-base text-white">Item Permintaan</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wider text-slate-500">
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
                  {isSuperAdmin && <th className="pb-2"></th>}
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
                  return (
                  <tr key={x.id} className="border-b border-white/5">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{x.inventory_items?.name}</div>
                      <div className="font-mono text-xs text-slate-500">{x.inventory_items?.sku}</div>
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
                            <div key={i} className="text-slate-200">{b.trim()}</div>
                          ))}
                        </div>
                      ) : "—"}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {snList.length > 0 ? (
                        <div className="space-y-0.5">
                          {snList.map((s, i) => <div key={i} className="text-slate-200">{s}</div>)}
                        </div>
                      ) : "—"}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {x.resi ? (
                        <div className="space-y-0.5">
                          {x.resi.split("\n").map((r, i) => (
                            <div key={i} className="text-slate-200">{r.trim()}</div>
                          ))}
                        </div>
                      ) : "—"}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {srList.length > 0 ? (
                        <div className="space-y-0.5">
                          {[...new Set(srList)].map((s, i) => <div key={i} className="text-amber-200">{s}</div>)}
                        </div>
                      ) : (
                        <Badge variant={ITEM_VARIANT[x.item_status] ?? "default"}>
                          {REQUEST_ITEM_STATUS_LABELS[x.item_status]}
                        </Badge>
                      )}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {x.status_aset ? <span className="text-sky-200">{x.status_aset}</span> : "—"}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {ketList.length > 0 ? (
                        <div className="space-y-0.5">
                          {ketList.map((k, i) => <div key={i} className="text-slate-400">{k}</div>)}
                        </div>
                      ) : "—"}
                    </td>
                    {isSuperAdmin && (
                      <td className="py-2">
                        <div className="flex gap-1">
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
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 px-1 py-2 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Nama Barang</Label>
            <select
              value={eItemId}
              onChange={(e) => setEItemId(e.target.value)}
              className="w-full rounded-md border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white"
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
            <Label>Status Request</Label>
            <Input value={eStatusReq} onChange={(e) => setEStatusReq(e.target.value)} placeholder="cth: PENAMBAHAN" />
          </div>
          <div className="space-y-1.5">
            <Label>Status Asset</Label>
            <Input value={eStatusAset} onChange={(e) => setEStatusAset(e.target.value)} placeholder="cth: ASSET RETUR" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setEditItem(null)} disabled={eSaving}>
            Batal
          </Button>
          <Button onClick={saveItemEdit} disabled={eSaving}>
            {eSaving ? "Menyimpan…" : "Simpan"}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
