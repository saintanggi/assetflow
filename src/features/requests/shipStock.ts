/**
 * Aturan lokasi pemotong stok saat pengiriman permintaan + penerjemah pesan
 * error RPC `ship_request_items` ke bahasa yang bisa ditindaklanjuti.
 *
 * Kenapa dipisah dari halaman: menu Persediaan menampilkan stok TOTAL semua
 * lokasi, sedangkan RPC memotong stok dari SATU lokasi sesuai Status Aset
 * (lihat migrasi 20261016000032):
 *
 *     ASSET BARU   -> STOK-BARU
 *     ASSET RETUR  -> STOK-RETUR
 *     UNREADY      -> STOK-UNREADY
 *
 * Jadi stok bisa terlihat "ada 22" di Persediaan tetapi pengiriman tetap gagal
 * karena saldo lokasi pemotongnya 0 atau minus. Helper di sini dipakai untuk
 * menampilkan saldo per lokasi dan menjelaskan penolakan tersebut.
 */
import {
  EXCEL_STATUS_ASET_LOKASI,
  type ExcelStatusAset,
  type RequestItem,
} from "../../types/database";
import { parseStatusAset } from "../../lib/requestStatus";

export type LocationRow = { id: string; code: string; name: string };

/** Saldo per barang (total semua lokasi), key: item_id. */
export interface StockMap {
  [itemId: string]: number;
}

/** Saldo per kombinasi barang + lokasi, key: `item_id|location_id`. */
export interface StockByLocationMap {
  [itemLocationKey: string]: number;
}

export const locKey = (itemId: string, locationId: string) => `${itemId}|${locationId}`;

/** Kebalikan dari EXCEL_STATUS_ASET_LOKASI: kode lokasi -> jenis aset. */
export const ASET_BY_LOCATION_CODE: Record<string, ExcelStatusAset> = {
  "STOK-BARU": "ASSET BARU",
  "STOK-RETUR": "ASSET RETUR",
  "STOK-UNREADY": "UNREADY",
};

const fmtQty = (n: number) =>
  Number(n).toLocaleString("id-ID", { maximumFractionDigits: 3 });

/** Lokasi pemotong stok untuk satu baris permintaan (sama dengan aturan RPC). */
export function targetLocationOf(item: RequestItem, locations: LocationRow[]) {
  const aset = parseStatusAset(item.status_aset);
  const code = EXCEL_STATUS_ASET_LOKASI[aset];
  const loc = locations.find((l) => l.code.toUpperCase() === code.toUpperCase());
  return { aset, code, loc };
}

/** Rincian saldo semua lokasi, mis. "STOK-RETUR 22, STOK-BARU 0". */
export function stockBreakdown(
  itemId: string,
  locations: LocationRow[],
  stockByLoc: StockByLocationMap
): string {
  return locations
    .map((l) => ({ code: l.code, qty: stockByLoc[locKey(itemId, l.id)] ?? 0 }))
    .filter((x) => x.qty !== 0)
    .sort((a, b) => b.qty - a.qty)
    .map((x) => `${x.code} ${fmtQty(x.qty)}`)
    .join(", ");
}

/** Lokasi lain yang saldonya cukup untuk qty tertentu (kandidat pemindahan). */
export function bestAlternativeLocation(
  itemId: string,
  locations: LocationRow[],
  stockByLoc: StockByLocationMap,
  qty: number,
  excludeLocationId?: string
) {
  return locations
    .map((l) => ({ l, qty: stockByLoc[locKey(itemId, l.id)] ?? 0 }))
    .filter((x) => x.l.id !== excludeLocationId && x.qty >= qty && qty > 0)
    .sort((a, b) => b.qty - a.qty)[0];
}

export interface ShipErrorContext {
  items: RequestItem[];
  locations: LocationRow[];
  stock: StockMap;
  stockByLoc: StockByLocationMap;
}

/**
 * Ubah pesan error teknis (berisi UUID) menjadi bahasa yang mudah dipahami:
 * nama barang, lokasi pemotong, saldo lokasi itu (termasuk bila negatif),
 * rincian stok semua lokasi, dan langkah perbaikan.
 */
export function formatShipError(raw: string, ctx: ShipErrorContext): string {
  const m = raw.match(
    /Stok tidak mencukupi \(item ([0-9a-f-]{36}),?\s*lokasi ([0-9a-f-]{36})\):\s*tersedia\s*(-?[\d.,]+),\s*perubahan\s*(-?[\d.,]+)/i
  );
  if (m) {
    const item = ctx.items.find((x) => x.item_id === m[1]);
    const itemName = item?.inventory_items?.name ?? "barang";
    const loc = ctx.locations.find((l) => l.id === m[2]);
    const locLabel = loc ? `${loc.code} — ${loc.name}` : "lokasi pemotong stok";
    const avail = Number(m[3].replace(/\s/g, ""));
    const need = Math.abs(Number(m[4].replace(/\s/g, "")));
    const total = item ? (ctx.stock[item.item_id] ?? 0) : 0;
    const rincian = item ? stockBreakdown(item.item_id, ctx.locations, ctx.stockByLoc) : "";
    const parts: string[] = [
      `Stok "${itemName}" di lokasi ${locLabel} tidak cukup: tersedia ${fmtQty(avail)}, dibutuhkan ${fmtQty(need)}.`,
    ];

    if (item) {
      const target = targetLocationOf(item, ctx.locations);
      parts.push(
        `Stok total semua lokasi ${fmtQty(total)}${rincian ? ` (${rincian})` : ""}. ` +
          `Baris ini dipotong dari ${target.code} karena Status Aset ${target.aset}.`
      );
    }
    if (avail < 0) {
      parts.push(
        "Saldo lokasi ini minus, sehingga setiap pengiriman ditolak. Perbaiki dulu saldonya di menu Stock Opname, atau pindahkan stok dari lokasi lain."
      );
    }

    if (item) {
      const alt = bestAlternativeLocation(
        item.item_id,
        ctx.locations,
        ctx.stockByLoc,
        need,
        loc?.id
      );
      if (alt) {
        const current = parseStatusAset(item.status_aset);
        const asetForAlt = ASET_BY_LOCATION_CODE[alt.l.code.toUpperCase()];
        parts.push(
          `Stok ${fmtQty(alt.qty)} ada di ${alt.l.code} — pindahkan stoknya ke ${
            loc?.code ?? "lokasi pemotong"
          } (Transfers/Stock Opname)${
            asetForAlt && asetForAlt !== current
              ? `, atau ubah Status Aset baris ini dari ${current} ke ${asetForAlt}`
              : ""
          }.`
        );
      }
    }
    return parts.join(" ");
  }
  return (
    raw
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]")
      .trim() || "Gagal mengirim."
  );
}
