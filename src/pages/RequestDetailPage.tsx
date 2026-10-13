import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, PackageCheck, Printer, Send, XCircle } from "lucide-react";
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
};

const fmt = (n: number) => Number(n).toLocaleString("id-ID", { maximumFractionDigits: 3 });

interface StockMap {
  [itemId: string]: number;
}

export function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, hasPermission } = useAuth();
  const [req, setReq] = useState<Request | null>(null);
  const [items, setItems] = useState<RequestItem[]>([]);
  const [stock, setStock] = useState<StockMap>({});
  const [locations, setLocations] = useState<{ id: string; code: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Review state (admin gudang)
  const [approved, setApproved] = useState<Record<string, string>>({});
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);

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
        for (const x of items) {
          const q = Number(approved[x.id]);
          if (!(q >= 0) || q > Number(x.qty_requested)) {
            throw new Error(`Qty setuju "${x.inventory_items?.name}" harus 0–${fmt(Number(x.qty_requested))}.`);
          }
        }
        for (const x of items) {
          const q = Number(approved[x.id]);
          const { error } = await supabase
            .from("request_items")
            .update({
              qty_approved: q,
              item_status: q > 0 ? "disetujui" : "ditolak",
            })
            .eq("id", x.id);
          if (error) throw new Error(error.message);
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
      toast.error(e instanceof Error ? e.message : "Gagal mengirim.");
    } finally {
      setBusy(false);
    }
  };

  const handlePrint = () => window.print();

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
        title={req.request_number}
        description={`Tiket ${req.ticket_no} • ${req.branch_name}${req.branch_code ? ` (${req.branch_code})` : ""} • ${req.request_date}`}
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
                  <th className="pb-2 pr-3">Barang</th>
                  <th className="pb-2 pr-3 text-right">Minta</th>
                  <th className="pb-2 pr-3 text-right">Disetujui</th>
                  <th className="pb-2 pr-3 text-right">Terkirim</th>
                  <th className="pb-2 pr-3">Barcode / SN</th>
                  <th className="pb-2 pr-3">Resi</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((x) => (
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
                      {x.barcode ?? "—"}
                      {x.serial_number && <div className="text-slate-500">SN: {x.serial_number}</div>}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">{x.resi ?? "—"}</td>
                    <td className="py-2">
                      <Badge variant={ITEM_VARIANT[x.item_status] ?? "default"}>
                        {REQUEST_ITEM_STATUS_LABELS[x.item_status]}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
