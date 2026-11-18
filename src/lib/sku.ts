import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * SKU otomatis gaya company besar — skema keluarga XXX-NNN.
 *
 * Format: 3 huruf inisial keluarga barang + nomor urut 3 digit di dalam
 * keluarga itu (diurutkan A-Z berdasarkan nama). Contoh: ACI-001 (AC Indoor),
 * PRN-003 (Printer Thermal TP806), KIP-004 (Kipas Angin Wall Regency).
 *
 * Aturan keluarga di sini HARUS sama dengan pemetaan SKU 18 Nov 2026
 * (187 barang, ~/workspace/goals/assetflow-warehouse-app-development/
 * hidden_files/sku_mapping_draft_20261118.json). Barang baru lanjut ke
 * nomor berikutnya di keluarganya; SKU lama tidak dipakai lagi.
 */
export function familyCodeForName(name: string): string {
  const n = name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const t = n.split(" ");
  const has = (s: string) => n.includes(s);
  if (has("MONITOR")) return "MON";
  if (t.includes("AC") || n.startsWith("OUT AC") || n.startsWith("IN AC"))
    return t.includes("OUT") || t.includes("OUTDOOR") ? "ACO" : "ACI";
  if (has("WHITEBOARD") || has("WHITBOARD")) return "WBD";
  if (has("KIPAS")) return "KIP";
  if (has("SWITCH HUB")) return "SWH";
  if (has("KURSI")) return "KRS";
  if (has("GENSET")) return "GEN";
  if (has("LAPTOP")) return "LTP";
  if (has("PRINTER")) return "PRN";
  if (has("DISPENSER")) return "DSP";
  if (has("IP CAMERA")) return "IPC";
  if (has("POWER SUPPLY") || t.includes("PSU")) return "PSU";
  if (has("ADAPTOR")) return "ADP";
  if (has("CCTV")) return has("OUTDOOR") ? "CCO" : "CCI";
  if (has("DVR")) return "DVR";
  if (t.includes("CPU") || has("MINI PC") || n.startsWith("PC ")) return "CPU";
  if (has("HARDISK")) return "HDD";
  if (has("TELEPON")) return "TLP";
  if (has("KEYBOARD")) return "KBD";
  if (has("KABEL")) return "KBL";
  if (has("SCANNER")) return "SCN";
  if (has("TIMBANGAN")) return "TMB";
  if (has("MODEM") || has("ROUTER") || has("WIFI") || has("DONGLE")) return "NET";
  if (has("MESIN")) return "MES";
  if (has("CHEST FREEZER")) return "FRZ";
  if (has("RAK SERVER")) return "RKS";
  if (has("BAG RACK")) return "RAK";
  if (has("BRACKET")) return "BRC";
  if (has("HANDPALLET")) return "HDP";
  if (has("TROLLY") || has("KERANJANG")) return "TRL";
  if (has("RAM BESI")) return "RMB";
  if (has("MICRO SD")) return "MSD";
  if (has("MOUSE")) return "MSE";
  if (has("SPEAKER")) return "SPK";
  if (has("MEJA")) return "MJA";
  if (has("LACI")) return "LAC";
  if (has("LEMARI")) return "LEM";
  if (has("PALLET")) return "PAL";
  if (has("AIR PURIFIER")) return "APR";
  if (has("APAR")) return "APF";
  if (has("BRANKAS")) return "BRK";
  if (has("EXHAUST FAN")) return "EXF";
  if (has("WEBCAM")) return "WCM";
  if (has("KOTAK P3K")) return "P3K";
  if (has("WIRELESS GATEWAY")) return "GTW";
  if (has("CAMERA")) return "CAM";
  if (has("RIDER")) return "RDR";
  if (t.includes("UPS")) return "UPS";
  if (has("BAGING HOLDER")) return "HLD";
  if (has("HANDPHONE")) return "HPH";
  if (has("HOOK")) return "HOK";
  if (has("METERAN")) return "MET";
  if (has("MIKROTIK")) return "MIK";
  if (has("STANDING")) return "STA";
  if (has("TANGGA")) return "TAN";
  return t[0].slice(0, 3);
}

export function formatSku(family: string, n: number): string {
  return `${family}-${String(n).padStart(3, "0")}`;
}

const SKU_RE = /^([A-Z0-9]{3})-(\d+)$/;

/** Nomor urut berikutnya per keluarga dari daftar SKU yang sudah ada. */
export function nextNumbers(existingSkus: string[], families: string[]): Record<string, number> {
  const max: Record<string, number> = {};
  for (const sku of existingSkus) {
    const m = SKU_RE.exec(sku);
    if (m) max[m[1]] = Math.max(max[m[1]] ?? 0, parseInt(m[2], 10));
  }
  const out: Record<string, number> = {};
  for (const f of families) out[f] = (max[f] ?? 0) + 1;
  return out;
}

/** SKU untuk satu barang baru (dipakai form Master Barang). */
export async function generateSku(client: SupabaseClient, name: string): Promise<string> {
  const family = familyCodeForName(name);
  const { data, error } = await client.from("inventory_items").select("sku").like("sku", `${family}-%`);
  if (error) throw new Error(error.message);
  const next = nextNumbers(
    ((data ?? []) as { sku: string }[]).map((r) => r.sku),
    [family],
  )[family];
  return formatSku(family, next);
}

/**
 * SKU untuk banyak barang baru sekaligus (dipakai upload buat-otomatis).
 * Nomor dihitung berurutan dari satu tarikan data supaya dua barang baru
 * dari keluarga yang sama tidak dapat nomor yang sama di dalam satu batch.
 */
export async function generateSkus(client: SupabaseClient, names: string[]): Promise<string[]> {
  const families = names.map(familyCodeForName);
  const { data, error } = await client.from("inventory_items").select("sku").limit(5000);
  if (error) throw new Error(error.message);
  const max: Record<string, number> = {};
  for (const row of (data ?? []) as { sku: string }[]) {
    const m = SKU_RE.exec(row.sku);
    if (m) max[m[1]] = Math.max(max[m[1]] ?? 0, parseInt(m[2], 10));
  }
  return families.map((f) => {
    const n = (max[f] ?? 0) + 1;
    max[f] = n;
    return formatSku(f, n);
  });
}
