// Salin parser dari src/lib/shippingUpload.ts ke folder Edge Function.
// Dijalankan dengan: npm run sync:parser
import { readFileSync, writeFileSync } from "node:fs";

const SRC = "src/lib/shippingUpload.ts";
const DST = "supabase/functions/sync-sheets/shippingUpload.ts";
const HEADER = `// =============================================================================
// SALINAN OTOMATIS dari ${SRC} — JANGAN EDIT DI SINI.
// Ubah parser di ${SRC} lalu jalankan: npm run sync:parser
// (tes src/lib/__sheetSyncSame.test.ts akan gagal bila kedua file berbeda).
// =============================================================================
`;

const src = readFileSync(SRC, "utf8").replace('import * as XLSX from "xlsx";', 'import * as XLSX from "./xlsx.ts";');
writeFileSync(DST, HEADER + src);
console.log(`✓ ${SRC} → ${DST}`);
