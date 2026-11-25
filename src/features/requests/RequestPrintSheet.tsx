import { todayLocalDate } from "../../lib/format";
import type { Request } from "../../types/database";

interface RequestPrintSheetProps {
  req: Request;
  printMode: "picklist" | "surat_jalan";
}

/**
 * Lembar cetak Surat Jalan / Pick List Gudang — hanya tampil saat print (`print:block`).
 */
export function RequestPrintSheet({ req, printMode }: RequestPrintSheetProps) {
  return (
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
          <p>Tanggal Cetak: {todayLocalDate()}</p>
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
  );
}
