import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Download, Pencil } from "lucide-react";
import { supabase } from "../lib/supabase";
import { formatQty } from "../lib/format";
import { exportToCsv } from "../lib/csv";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { DataTable } from "../components/DataTable";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";

export type KondisiStok = "baru" | "return" | "unready";

const KONDISI_CONFIG: Record<
  KondisiStok,
  { title: string; description: string; locationCode: string; badge: string }
> = {
  baru: {
    title: "Asset Baru",
    description: "Stok barang kondisi baru per item.",
    locationCode: "STOK-BARU",
    badge: "BARU",
  },
  return: {
    title: "Asset Return",
    description: "Stok barang return per item.",
    locationCode: "STOK-RETUR",
    badge: "RETURN",
  },
  unready: {
    title: "Asset Unready",
    description: "Stok barang unready per item.",
    locationCode: "STOK-UNREADY",
    badge: "UNREADY",
  },
};

interface StokRow {
  id: string;
  no: number;
  itemName: string;
  satuan: string;
  stokAwal: number;
  totalIn: number;
  totalOut: number;
  stokAkhir: number;
  buffer: number;
  status: "AMAN" | "KRITIS" | "HABIS";
}

export function StokKondisiPage({ kondisi }: { kondisi: KondisiStok }) {
  const cfg = KONDISI_CONFIG[kondisi];
  const { isSuperAdmin } = useAuth();
  const [rows, setRows] = useState<StokRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [locationId, setLocationId] = useState<string | null>(null);

  // Edit inline (superadmin): nama & qty stok awal.
  const [editOpen, setEditOpen] = useState(false);
  const [editRow, setEditRow] = useState<StokRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editQty, setEditQty] = useState("");
  const [editBuffer, setEditBuffer] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      // Cari lokasi untuk kondisi ini.
      const { data: locData } = await supabase
        .from("locations")
        .select("id")
        .eq("code", cfg.locationCode)
        .maybeSingle();
      const locationId = (locData as { id: string } | null)?.id ?? null;

      // Semua item aktif + satuan.
      const { data: items, error: itemErr } = await supabase
        .from("inventory_items")
        .select("id, name, min_stock, units(code)")
        .eq("is_active", true)
        .order("name");
      if (itemErr) throw new Error(itemErr.message);

      // Saldo + stok awal per lokasi kondisi.
      const balanceMap = new Map<string, number>();
      const openingMap = new Map<string, number>();
      // IN/OUT dari ledger per lokasi kondisi.
      const inMap = new Map<string, number>();
      const outMap = new Map<string, number>();

      if (locationId) {
        setLocationId(locationId);
        const { data: bals } = await supabase
          .from("inventory_balances")
          .select("item_id, qty, opening_qty")
          .eq("location_id", locationId);
        for (const b of (bals ?? []) as { item_id: string; qty: number | string; opening_qty: number | string }[]) {
          balanceMap.set(b.item_id, Number(b.qty));
          openingMap.set(b.item_id, Number(b.opening_qty ?? 0));
        }

        const { data: leds } = await supabase
          .from("inventory_ledger")
          .select("item_id, qty_change")
          .eq("location_id", locationId)
          .limit(10000);
        for (const l of (leds ?? []) as { item_id: string; qty_change: number | string }[]) {
          const q = Number(l.qty_change);
          if (q > 0) inMap.set(l.item_id, (inMap.get(l.item_id) ?? 0) + q);
          else if (q < 0) outMap.set(l.item_id, (outMap.get(l.item_id) ?? 0) + Math.abs(q));
        }
      }

      const mapped: StokRow[] = ((items ?? []) as {
        id: string;
        name: string;
        min_stock: number | null;
        units: { code: string } | { code: string }[] | null;
      }[]).map((it, idx) => {
        const stokAwal = openingMap.get(it.id) ?? 0;
        const totalIn = inMap.get(it.id) ?? 0;
        const totalOut = outMap.get(it.id) ?? 0;
        const stokAkhir = stokAwal + totalIn - totalOut;
        const buffer = Number(it.min_stock ?? 0);
        const units = Array.isArray(it.units) ? it.units[0] : it.units;
        let status: StokRow["status"] = "AMAN";
        if (stokAkhir <= 0) status = "HABIS";
        else if (buffer > 0 && stokAkhir <= buffer) status = "KRITIS";
        return {
          id: it.id,
          no: idx + 1,
          itemName: it.name,
          satuan: units?.code?.toUpperCase() ?? "—",
          stokAwal,
          totalIn,
          totalOut,
          stokAkhir,
          buffer,
          status,
        };
      });
      setRows(mapped);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memuat data stok.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kondisi]);

  const totals = useMemo(() => {
    return rows.reduce(
      (s, r) => ({
        awal: s.awal + r.stokAwal,
        in: s.in + r.totalIn,
        out: s.out + r.totalOut,
        akhir: s.akhir + r.stokAkhir,
      }),
      { awal: 0, in: 0, out: 0, akhir: 0 }
    );
  }, [rows]);

  const statusBadge = (s: StokRow["status"]) => {
    if (s === "AMAN") return <Badge variant="success">AMAN</Badge>;
    if (s === "KRITIS") return <Badge variant="destructive">KRITIS</Badge>;
    return <Badge variant="secondary">HABIS</Badge>;
  };

  const openEdit = (row: StokRow) => {
    setEditRow(row);
    setEditName(row.itemName);
    setEditQty(String(row.stokAwal));
    setEditBuffer(String(row.buffer));
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!editRow || !locationId) return;
    const qty = Number(editQty);
    const buffer = Number(editBuffer);
    if (!editName.trim()) {
      toast.error("Nama barang wajib diisi.");
      return;
    }
    if (isNaN(qty) || qty < 0) {
      toast.error("Stok awal harus angka ≥ 0.");
      return;
    }
    if (isNaN(buffer) || buffer < 0) {
      toast.error("Buffer harus angka ≥ 0.");
      return;
    }
    setEditSaving(true);
    try {
      // Update nama & buffer barang.
      const { error: nameErr } = await supabase
        .from("inventory_items")
        .update({ name: editName.trim(), min_stock: buffer })
        .eq("id", editRow.id);
      if (nameErr) throw new Error(nameErr.message);

      // Update stok awal (upsert balance).
      const { error: balErr } = await supabase
        .from("inventory_balances")
        .upsert(
          { item_id: editRow.id, location_id: locationId, qty: qty + editRow.totalIn - editRow.totalOut, opening_qty: qty },
          { onConflict: "item_id,location_id" }
        );
      if (balErr) throw new Error(balErr.message);

      toast.success("Berhasil diperbarui.");
      setEditOpen(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan.");
    } finally {
      setEditSaving(false);
    }
  };

  const columns: ColumnDef<StokRow, unknown>[] = [
    { header: "NO", accessorKey: "no", cell: ({ row }) => row.original.no },
    {
      header: "ITEM",
      accessorKey: "itemName",
      cell: ({ row }) => <span className="font-medium">{row.original.itemName}</span>,
    },
    { header: "SATUAN", accessorKey: "satuan" },
    {
      header: "STOK AWAL",
      accessorKey: "stokAwal",
      cell: ({ row }) => <span className="tnum">{formatQty(row.original.stokAwal)}</span>,
    },
    {
      header: "TOTAL IN",
      accessorKey: "totalIn",
      cell: ({ row }) => (
        <span className="tnum font-semibold text-emerald-300">+{formatQty(row.original.totalIn)}</span>
      ),
    },
    {
      header: "TOTAL OUT",
      accessorKey: "totalOut",
      cell: ({ row }) => (
        <span className="tnum font-semibold text-rose-300">-{formatQty(row.original.totalOut)}</span>
      ),
    },
    {
      header: "STOK AKHIR",
      accessorKey: "stokAkhir",
      cell: ({ row }) => (
        <span className="tnum font-bold">{formatQty(row.original.stokAkhir)}</span>
      ),
    },
    {
      header: "BUFFER MINIMUM",
      accessorKey: "buffer",
      cell: ({ row }) => <span className="tnum">{formatQty(row.original.buffer)}</span>,
    },
    {
      header: "STATUS",
      accessorKey: "status",
      cell: ({ row }) => statusBadge(row.original.status),
    },
    ...(isSuperAdmin
      ? [
          {
            header: "",
            id: "edit",
            cell: ({ row }: { row: { original: StokRow } }) => (
              <Button variant="outline" size="sm" onClick={() => openEdit(row.original)}>
                <Pencil className="mr-1 h-3 w-3" /> Ubah
              </Button>
            ),
          } as ColumnDef<StokRow, unknown>,
        ]
      : []),
  ];

  const handleExport = () => {
    if (rows.length === 0) {
      toast.error("Tidak ada data untuk diekspor.");
      return;
    }
    exportToCsv(
      `stok-${kondisi}`,
      rows.map((r) => ({
        NO: r.no,
        ITEM: r.itemName,
        SATUAN: r.satuan,
        "STOK AWAL": r.stokAwal,
        "TOTAL IN": r.totalIn,
        "TOTAL OUT": r.totalOut,
        "STOK AKHIR": r.stokAkhir,
        "BUFFER MINIMUM": r.buffer,
        STATUS: r.status,
      }))
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={cfg.title}
        description={cfg.description}
        actions={
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="mr-1 h-4 w-4" /> Export CSV
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-slate-500">TOTAL STOK AWAL</p>
            <p className="tnum font-display text-xl font-bold text-slate-200">{formatQty(totals.awal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-slate-500">TOTAL IN</p>
            <p className="tnum font-display text-xl font-bold text-emerald-300">+{formatQty(totals.in)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-slate-500">TOTAL OUT</p>
            <p className="tnum font-display text-xl font-bold text-rose-300">-{formatQty(totals.out)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-slate-500">TOTAL STOK AKHIR</p>
            <p className="tnum font-display text-xl font-bold text-amber-300">{formatQty(totals.akhir)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-6">
          <DataTable
            columns={columns}
            data={rows}
            loading={loading}
            searchPlaceholder="Cari nama barang…"
            pageSize={15}
            emptyTitle="Tidak ada data"
            emptyDescription={`Belum ada barang pada kondisi ${cfg.badge}.`}
          />
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogHeader>
          <DialogTitle>Ubah — {editRow?.itemName}</DialogTitle>
          <DialogDescription>
            Ubah nama barang dan stok awal ({cfg.badge}). Khusus superadmin.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-1 py-2">
          <div className="space-y-1.5">
            <Label>Nama Barang</Label>
            <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Stok Awal ({cfg.badge})</Label>
            <Input
              type="number"
              min="0"
              value={editQty}
              onChange={(e) => setEditQty(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Buffer Minimum</Label>
            <Input
              type="number"
              min="0"
              value={editBuffer}
              onChange={(e) => setEditBuffer(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setEditOpen(false)} disabled={editSaving}>
            Batal
          </Button>
          <Button onClick={saveEdit} disabled={editSaving}>
            {editSaving ? "Menyimpan…" : "Simpan"}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
