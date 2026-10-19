import { supabase } from "../../lib/supabase";

export interface SerialLabel { number: number; code: string; batch_id: string }
export interface LabelBatch {
  id: string; title: string; asset_id: string | null; item_id: string | null;
  quantity: number; created_at: string; created_by: string;
}
export interface LabelTarget { id: string; kind: "asset" | "item"; name: string; code: string }
export interface AllocationRequest { id: string; quantity: number; target: LabelTarget }

export async function allocateSerialLabels(request: AllocationRequest): Promise<SerialLabel[]> {
  const { data, error } = await supabase.rpc("allocate_qr_labels", {
    p_request_id: request.id, p_quantity: request.quantity,
    p_asset_id: request.target.kind === "asset" ? request.target.id : null,
    p_item_id: request.target.kind === "item" ? request.target.id : null,
  });
  if (error) throw error;
  const labels = (data ?? []) as SerialLabel[];
  if (!labels.length) throw new Error("Server tidak mengembalikan nomor label. Coba ulang permintaan yang sama.");
  return labels;
}

export async function fetchBatchLabels(batchId: string): Promise<SerialLabel[]> {
  const { data, error } = await supabase.from("qr_serial_labels").select("number, code, batch_id")
    .eq("batch_id", batchId).order("number");
  if (error) throw error;
  return (data ?? []) as SerialLabel[];
}

export function labelError(error: unknown): string {
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : "Koneksi gagal";
  if (/schema cache|does not exist|could not find/i.test(message)) {
    return "Fitur QR belum terpasang di database. Jalankan migrasi 20261019000038_serial_qr_labels.sql di Supabase.";
  }
  return message;
}
