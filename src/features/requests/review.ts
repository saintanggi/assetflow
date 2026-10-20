import type { Request, RequestItem } from "../../types/database";

export type ReviewRequestStatus = "disetujui" | "disetujui_sebagian";

type ReviewLine = Pick<
  RequestItem,
  | "id"
  | "request_id"
  | "item_id"
  | "qty_requested"
  | "item_type"
  | "status_aset"
  | "notes"
> & {
  name?: string | null;
};

type ReviewItemStatus = "disetujui" | "menunggu_stok";

type ReviewItemUpdate = {
  itemId: string;
  values: {
    qty_requested?: number;
    qty_approved: number | null;
    item_status: ReviewItemStatus;
    notes?: string | null;
  };
};

type PendingStockInsert = {
  request_id: string;
  item_id: string;
  qty_requested: number;
  qty_approved: null;
  qty_shipped: 0;
  item_type: string | null;
  status_aset: string | null;
  item_status: "menunggu_stok";
  notes: string;
};

export interface RequestReviewPlan {
  updates: ReviewItemUpdate[];
  pendingStockInserts: PendingStockInsert[];
  requestStatus: ReviewRequestStatus;
  pendingStockCount: number;
}

/** Simpan catatan gudang tanpa menghapus catatan asli pada baris permintaan. */
export function withWaitingStockNote(
  existingNotes: string | null | undefined,
  warehouseNote: string
): string {
  const note = warehouseNote.trim();
  const original = (existingNotes ?? "").trim();
  return [`Menunggu stok: ${note}`, original].filter(Boolean).join("\n");
}

/**
 * Siapkan perubahan database untuk review permintaan.
 * Qty 0 berarti stok belum tersedia: seluruh qty diminta tetap menjadi
 * menunggu_stok, bukan ditolak. Penolakan penuh dilakukan lewat aksi terpisah.
 */
export function buildRequestReviewPlan(
  items: ReviewLine[],
  approvedValues: Record<string, string>,
  warehouseNote: string
): RequestReviewPlan {
  if (items.length === 0) {
    throw new Error("Permintaan tidak memiliki item untuk direview.");
  }

  const decisions = items.map((item) => {
    const requested = Number(item.qty_requested);
    const approved = Number(approvedValues[item.id]);
    if (!Number.isFinite(approved) || approved < 0 || approved > requested) {
      const max = requested.toLocaleString("id-ID", { maximumFractionDigits: 3 });
      throw new Error(`Qty setuju "${item.name ?? "barang"}" harus 0–${max}.`);
    }
    return { item, requested, approved };
  });

  const pendingDecisions = decisions.filter(({ requested, approved }) => approved < requested);
  const note = warehouseNote.trim();
  if (pendingDecisions.length > 0 && !note) {
    throw new Error("Keterangan gudang wajib diisi bila ada item yang menunggu stok.");
  }

  const updates: ReviewItemUpdate[] = [];
  const pendingStockInserts: PendingStockInsert[] = [];

  for (const { item, requested, approved } of decisions) {
    if (approved === 0) {
      // Pertahankan qty penuh pada satu baris agar dapat disetujui saat restock.
      updates.push({
        itemId: item.id,
        values: {
          qty_approved: null,
          item_status: "menunggu_stok",
          notes: withWaitingStockNote(item.notes, note),
        },
      });
    } else if (approved < requested) {
      // Qty yang tersedia diproses sekarang; sisanya menjadi baris menunggu stok.
      updates.push({
        itemId: item.id,
        values: {
          qty_requested: approved,
          qty_approved: approved,
          item_status: "disetujui",
        },
      });
      pendingStockInserts.push({
        request_id: item.request_id,
        item_id: item.item_id,
        qty_requested: requested - approved,
        qty_approved: null,
        qty_shipped: 0,
        item_type: item.item_type ?? null,
        status_aset: item.status_aset ?? null,
        item_status: "menunggu_stok",
        notes: withWaitingStockNote(item.notes, note),
      });
    } else {
      updates.push({
        itemId: item.id,
        values: {
          qty_approved: approved,
          item_status: "disetujui",
        },
      });
    }
  }

  return {
    updates,
    pendingStockInserts,
    requestStatus: pendingDecisions.length > 0 ? "disetujui_sebagian" : "disetujui",
    pendingStockCount:
      decisions.filter(({ approved }) => approved === 0).length + pendingStockInserts.length,
  };
}

/**
 * Kenali item 0-qty yang ditolak oleh alur review lama dan aman dipulihkan.
 * Penolakan eksplisit memakai alasan di header, sehingga tidak ditawarkan
 * sebagai pemulihan ke menu Menunggu Stok.
 */
export function canRecoverZeroQtyItem(
  item: Pick<RequestItem, "item_status" | "qty_requested" | "qty_approved" | "qty_shipped">,
  request: Pick<Request, "status" | "rejection_reason">
): boolean {
  if (
    item.item_status !== "ditolak" ||
    Number(item.qty_requested) <= 0 ||
    Number(item.qty_approved ?? 0) !== 0 ||
    Number(item.qty_shipped ?? 0) !== 0
  ) {
    return false;
  }
  return !(request.status === "ditolak" && Boolean(request.rejection_reason?.trim()));
}
