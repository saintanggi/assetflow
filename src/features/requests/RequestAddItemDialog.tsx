import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Select } from "../../components/ui/select";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import {
  EXCEL_STATUS_ASET_LABELS,
  type ExcelStatusAset,
} from "../../types/database";

export interface AddableMasterItem {
  id: string;
  sku: string;
  name: string;
}

interface RequestAddItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  addQuery: string;
  onAddQueryChange: (q: string) => void;
  addSearching: boolean;
  addResults: AddableMasterItem[];
  addItem: AddableMasterItem | null;
  onPickItem: (item: AddableMasterItem) => void;
  addQty: string;
  onAddQtyChange: (qty: string) => void;
  addStatusAset: ExcelStatusAset;
  onAddStatusAsetChange: (v: ExcelStatusAset) => void;
  addSaving: boolean;
  onSubmit: () => void;
}

/** Dialog tambah barang baru ke tiket permintaan yang masih diajukan. */
export function RequestAddItemDialog({
  open,
  onOpenChange,
  addQuery,
  onAddQueryChange,
  addSearching,
  addResults,
  addItem,
  onPickItem,
  addQty,
  onAddQtyChange,
  addStatusAset,
  onAddStatusAsetChange,
  addSaving,
  onSubmit,
}: RequestAddItemDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Tambah Barang ke Tiket</DialogTitle>
        <DialogDescription>
          Cari barang, isi qty, lalu simpan. Barang langsung masuk daftar permintaan tiket ini.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label>Cari Barang</Label>
          <Input
            value={addQuery}
            onChange={(e) => onAddQueryChange(e.target.value)}
            placeholder="Ketik nama atau SKU barang…"
          />
          {addSearching && <p className="text-xs text-ink-500">Mencari…</p>}
          {addResults.length > 0 && !addItem && (
            <div className="max-h-48 overflow-y-auto rounded-lg border border-ink-200 bg-white">
              {addResults.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-brand-50"
                  onClick={() => onPickItem(r)}
                >
                  <span className="font-medium">{r.name}</span>
                  <span className="ml-2 font-mono text-xs text-ink-500">{r.sku}</span>
                </button>
              ))}
            </div>
          )}
          {addItem && (
            <p className="text-xs text-ink-500">
              Terpilih: <b className="text-ink-800">{addItem.name}</b>{" "}
              <span className="font-mono">({addItem.sku})</span>
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Qty</Label>
            <Input
              type="number"
              min="1"
              value={addQty}
              onChange={(e) => onAddQtyChange(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Status Asset</Label>
            <Select
              value={addStatusAset}
              onValueChange={(v) => onAddStatusAsetChange(v as ExcelStatusAset)}
              options={(Object.keys(EXCEL_STATUS_ASET_LABELS) as ExcelStatusAset[]).map((o) => ({
                value: o,
                label: EXCEL_STATUS_ASET_LABELS[o],
              }))}
            />
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={addSaving}>
          Batal
        </Button>
        <Button onClick={onSubmit} disabled={addSaving || !addItem}>
          {addSaving ? "Menyimpan…" : "Tambah ke Tiket"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
