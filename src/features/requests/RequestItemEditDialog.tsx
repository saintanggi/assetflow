import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Select } from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import {
  EXCEL_STATUS_ASET_LABELS,
  EXCEL_STATUS_ASET_LOKASI,
  STATUS_REQUEST_LABELS,
  STATUS_REQUEST_OPTIONS,
  type ExcelStatusAset,
  type RequestItem,
  type StatusRequest,
} from "../../types/database";

interface RequestItemEditDialogProps {
  editItem: RequestItem | null;
  onClose: () => void;
  masterItems: { id: string; name: string }[];
  eItemId: string;
  onItemIdChange: (v: string) => void;
  eBarcode: string;
  onBarcodeChange: (v: string) => void;
  eSn: string;
  onSnChange: (v: string) => void;
  eResi: string;
  onResiChange: (v: string) => void;
  eKet: string;
  onKetChange: (v: string) => void;
  eStatusReq: StatusRequest;
  onStatusReqChange: (v: StatusRequest) => void;
  eDurasiPinjam: string;
  onDurasiPinjamChange: (v: string) => void;
  eStatusAset: ExcelStatusAset;
  onStatusAsetChange: (v: ExcelStatusAset) => void;
  editNeedsStockMove: boolean;
  eReason: string;
  onReasonChange: (v: string) => void;
  eSaving: boolean;
  onSave: () => void;
}

/** Dialog revisi item permintaan (khusus Super Admin), dilengkapi peringatan pemindahan stok atomik. */
export function RequestItemEditDialog({
  editItem,
  onClose,
  masterItems,
  eItemId,
  onItemIdChange,
  eBarcode,
  onBarcodeChange,
  eSn,
  onSnChange,
  eResi,
  onResiChange,
  eKet,
  onKetChange,
  eStatusReq,
  onStatusReqChange,
  eDurasiPinjam,
  onDurasiPinjamChange,
  eStatusAset,
  onStatusAsetChange,
  editNeedsStockMove,
  eReason,
  onReasonChange,
  eSaving,
  onSave,
}: RequestItemEditDialogProps) {
  return (
    <Dialog open={!!editItem} onOpenChange={(o) => !o && onClose()}>
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
            onChange={(e) => onItemIdChange(e.target.value)}
            className="w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-800"
          >
            {masterItems.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Barcode (satu per baris)</Label>
          <Textarea rows={4} value={eBarcode} onChange={(e) => onBarcodeChange(e.target.value)} className="font-mono text-xs" />
        </div>
        <div className="space-y-1.5">
          <Label>SN (satu per baris)</Label>
          <Textarea rows={4} value={eSn} onChange={(e) => onSnChange(e.target.value)} className="font-mono text-xs" />
        </div>
        <div className="space-y-1.5">
          <Label>Resi (satu per baris)</Label>
          <Textarea rows={3} value={eResi} onChange={(e) => onResiChange(e.target.value)} className="font-mono text-xs" />
        </div>
        <div className="space-y-1.5">
          <Label>Keterangan (satu per baris)</Label>
          <Textarea rows={3} value={eKet} onChange={(e) => onKetChange(e.target.value)} className="font-mono text-xs" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-status-request">Status Request</Label>
          <Select
            id="edit-status-request"
            value={eStatusReq}
            onValueChange={(v) => onStatusReqChange(v as StatusRequest)}
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
              onChange={(e) => onDurasiPinjamChange(e.target.value)}
              placeholder="cth: 1 MINGGU"
            />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="edit-status-asset">Status Asset</Label>
          <Select
            id="edit-status-asset"
            value={eStatusAset}
            onValueChange={(v) => onStatusAsetChange(v as ExcelStatusAset)}
            options={(Object.keys(EXCEL_STATUS_ASET_LABELS) as ExcelStatusAset[]).map((o) => ({
              value: o,
              label: EXCEL_STATUS_ASET_LABELS[o],
            }))}
          />
          <p className="mt-1 text-xs text-ink-500">
            Stok dipotong dari <b>{EXCEL_STATUS_ASET_LOKASI[eStatusAset]}</b> saat barang terkirim.
          </p>
        </div>
        {editNeedsStockMove && (
          <div className="space-y-2 rounded-lg border border-warn-200 bg-warn-50 p-3 sm:col-span-2">
            <p className="text-xs font-medium text-warn-800">
              Item ini sudah terkirim ({editItem?.qty_shipped ?? 0} unit). Menyimpan perubahan
              Nama Barang atau Status Asset akan otomatis mengembalikan stok ke barang/gudang lama
              (IN) dan memotong stok dari barang/gudang baru (OUT) secara atomik.
            </p>
            <div className="space-y-1">
              <Label htmlFor="edit-reason" className="text-xs text-warn-900">
                Alasan koreksi stok (opsional)
              </Label>
              <Input
                id="edit-reason"
                value={eReason}
                onChange={(e) => onReasonChange(e.target.value)}
                placeholder="cth: Salah pilih tipe barang saat pengiriman"
              />
            </div>
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={eSaving}>
          Batal
        </Button>
        <Button onClick={onSave} disabled={eSaving}>
          {eSaving ? "Menyimpan…" : "Simpan"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
