import { useEffect, useState } from "react";
import type { HTMLAttributes } from "react";
import { useParams } from "react-router-dom";
import { PackageCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { badgeDarkClass, poStatusVariant } from "../lib/statusColors";
import { cn } from "../lib/utils";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select } from "../components/ui/select";
import { PO_STATUS_LABELS, type PoStatus } from "./PurchaseOrderListPage";

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

const fmtRp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;
const fmt = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 3 });

interface PoItem {
  id: string;
  item_id: string;
  sku: string;
  name: string;
  qty_ordered: number;
  qty_received: number;
  unit_price: number;
}

interface PoDetail {
  id: string;
  po_number: string;
  supplier_name: string;
  status: PoStatus;
  order_date: string;
  expected_date: string | null;
  total_amount: number;
  notes: string | null;
  items: PoItem[];
}

export function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [po, setPo] = useState<PoDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [locations, setLocations] = useState<{ id: string; code: string; name: string }[]>([]);
  const [locationId, setLocationId] = useState("");
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});
  const [receiving, setReceiving] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [{ data, error }, locRes] = await Promise.all([
        supabase
          .from("purchase_orders")
          .select(
            "id, po_number, status, order_date, expected_date, total_amount, notes, suppliers(name), purchase_order_items(id, item_id, qty_ordered, qty_received, unit_price, inventory_items(sku, name))"
          )
          .eq("id", id)
          .single(),
        supabase.from("locations").select("id, code, name").eq("is_active", true).order("code"),
      ]);
      if (error || !data) throw new Error(error?.message ?? "PO tidak ditemukan");
      if (locRes.error) throw new Error(locRes.error.message);
      const raw = data as unknown as {
        id: string;
        po_number: string;
        status: PoStatus;
        order_date: string;
        expected_date: string | null;
        total_amount: number | string;
        notes: string | null;
        suppliers: { name: string } | { name: string }[] | null;
        purchase_order_items: {
          id: string;
          item_id: string;
          qty_ordered: number | string;
          qty_received: number | string;
          unit_price: number | string;
          inventory_items: { sku: string; name: string } | { sku: string; name: string }[] | null;
        }[];
      };
      const sup = Array.isArray(raw.suppliers) ? raw.suppliers[0] : raw.suppliers;
      const items: PoItem[] = (raw.purchase_order_items ?? []).map((pi) => {
        const it = Array.isArray(pi.inventory_items) ? pi.inventory_items[0] : pi.inventory_items;
        return {
          id: pi.id,
          item_id: pi.item_id,
          sku: it?.sku ?? "—",
          name: it?.name ?? "—",
          qty_ordered: Number(pi.qty_ordered),
          qty_received: Number(pi.qty_received),
          unit_price: Number(pi.unit_price),
        };
      });
      setPo({
        id: raw.id,
        po_number: raw.po_number,
        supplier_name: sup?.name ?? "—",
        status: raw.status,
        order_date: raw.order_date,
        expected_date: raw.expected_date,
        total_amount: Number(raw.total_amount),
        notes: raw.notes,
        items,
      });
      setLocations((locRes.data ?? []) as { id: string; code: string; name: string }[]);
      // Default lokasi: STOK-BARU kalau ada.
      const baru = ((locRes.data ?? []) as { id: string; code: string }[]).find(
        (l) => l.code === "STOK-BARU"
      );
      if (baru) setLocationId(baru.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memuat PO");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const canReceive = po && (po.status === "ordered" || po.status === "received_partial");
  const remaining = (item: PoItem) => item.qty_ordered - item.qty_received;

  const doReceive = async () => {
    if (!po || !locationId) {
      toast.error("Pilih lokasi tujuan dulu.");
      return;
    }
    const payload = po.items
      .map((it) => ({ po_item_id: it.id, qty: Number(receiveQty[it.id] ?? 0) }))
      .filter((p) => p.qty > 0);
    if (payload.length === 0) {
      toast.error("Isi qty terima minimal 1 baris.");
      return;
    }
    const over = payload.find((p) => {
      const it = po.items.find((x) => x.id === p.po_item_id)!;
      return p.qty > remaining(it);
    });
    if (over) {
      toast.error("Qty terima melebihi qty pesan.");
      return;
    }
    setReceiving(true);
    try {
      const { data, error } = await supabase.rpc("receive_purchase_order", {
        p_po_id: po.id,
        p_items: payload,
        p_location_id: locationId,
      });
      if (error) throw new Error(error.message);
      toast.success(`Barang diterima — dokumen ${data}`);
      setReceiveQty({});
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menerima barang");
    } finally {
      setReceiving(false);
    }
  };

  const setStatus = async (status: PoStatus) => {
    if (!po) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("purchase_orders").update({ status }).eq("id", po.id);
      if (error) throw new Error(error.message);
      toast.success(`PO ${PO_STATUS_LABELS[status]}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mengubah status");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="py-12 text-center text-sm text-ink-300">Memuat PO…</p>;
  if (!po) return <p className="py-12 text-center text-sm text-ink-300">PO tidak ditemukan.</p>;

  return (
    <div>
      <PageHeader
        title={po.po_number}
        description={`${po.supplier_name} — pesan ${new Date(po.order_date).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}`}
        actions={
          <div className="flex gap-2">
            {po.status === "draft" && (
              <Button disabled={busy} onClick={() => setStatus("ordered")}>
                Pesan ke Supplier
              </Button>
            )}
            {(po.status === "draft" || po.status === "ordered") && (
              <Button variant="outline" className={DARK_OUTLINE_BTN} disabled={busy} onClick={() => setStatus("cancelled")}>
                <Trash2 className="mr-1 h-4 w-4" /> Batalkan
              </Button>
            )}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Badge variant={poStatusVariant[po.status]} className={badgeDarkClass[poStatusVariant[po.status]]}>{PO_STATUS_LABELS[po.status]}</Badge>
        {po.expected_date && (
          <span className="text-sm text-ink-300">
            Estimasi datang: {new Date(po.expected_date).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}
          </span>
        )}
        <span className="tnum ml-auto text-lg font-bold text-white">Total: {fmtRp(po.total_amount)}</span>
      </div>

      {po.notes && (
        <GlassCard className="mb-4">
          <CardContent className="p-4">
            <p className="text-sm text-ink-300">{po.notes}</p>
          </CardContent>
        </GlassCard>
      )}

      <GlassCard>
        <CardHeader>
          <CardTitle className="text-white">Item PO</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-ink-300">
                  <th className="py-2 pr-2">Barang</th>
                  <th className="py-2 pr-2 text-right">Pesan</th>
                  <th className="py-2 pr-2 text-right">Diterima</th>
                  <th className="py-2 pr-2 text-right">Sisa</th>
                  <th className="py-2 pr-2 text-right">Harga</th>
                  {canReceive && <th className="py-2 text-right">Terima Sekarang</th>}
                </tr>
              </thead>
              <tbody>
                {po.items.map((it) => (
                  <tr key={it.id} className="border-b border-white/10 text-ink-100 transition-colors last:border-0 hover:bg-white/5">
                    <td className="py-2 pr-2">
                      <div className="font-medium">{it.name}</div>
                      <div className="font-mono text-xs text-ink-300">{it.sku}</div>
                    </td>
                    <td className="tnum py-2 pr-2 text-right">{fmt(it.qty_ordered)}</td>
                    <td className="tnum py-2 pr-2 text-right">{fmt(it.qty_received)}</td>
                    <td className="tnum py-2 pr-2 text-right font-semibold">{fmt(remaining(it))}</td>
                    <td className="tnum py-2 pr-2 text-right">{fmtRp(it.unit_price)}</td>
                    {canReceive && (
                      <td className="py-2 text-right">
                        <Input
                          type="number"
                          min="0"
                          max={remaining(it)}
                          step="1"
                          className="ml-auto w-24 border-white/15 bg-white/10 text-right text-white placeholder:text-ink-300"
                          placeholder="0"
                          value={receiveQty[it.id] ?? ""}
                          disabled={remaining(it) <= 0}
                          onChange={(e) => setReceiveQty((p) => ({ ...p, [it.id]: e.target.value }))}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {canReceive && (
            <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-white/15 pt-4">
              <div className="min-w-48">
                <Label className="text-white">Lokasi Tujuan *</Label>
                <Select
                  className="border-white/15 bg-white/10 text-white [color-scheme:dark]"
                  value={locationId}
                  onValueChange={setLocationId}
                  placeholder="Pilih lokasi…"
                  options={locations.map((l) => ({
                    value: l.id,
                    label: `${l.code} — ${l.name}`,
                  }))}
                />
              </div>
              <Button disabled={receiving} onClick={doReceive}>
                <PackageCheck className="mr-2 h-4 w-4" />
                {receiving ? "Memproses…" : "Terima Barang (Masuk Stok)"}
              </Button>
              <p className="text-xs text-ink-300">
                Barang yang diterima langsung masuk stok & tercatat sebagai Barang Masuk (dokumen IN).
              </p>
            </div>
          )}
        </CardContent>
      </GlassCard>
    </div>
  );
}
