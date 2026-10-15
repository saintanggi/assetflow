// Gabungkan Edge Function sync-sheets menjadi SATU file
// (docs/sync-sheets-standalone.ts) supaya bisa ditempel langsung di
// Supabase Dashboard → Edge Functions → Create function (tanpa install CLI).
// Jalankan: npm run bundle:sync-fn
import { readFileSync, writeFileSync } from "node:fs";

/** Buang import ke modul lokal / xlsx (nanti diganti satu import di header bundle). */
function stripImports(src) {
  const lines = src.split("\n");
  const kept = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^import\s/.test(line)) {
      let stmt = line;
      while (!stmt.trimEnd().endsWith(";") && i + 1 < lines.length) {
        i++;
        stmt += "\n" + lines[i];
      }
      const local = /from "\.\/(xlsx|shippingUpload|googleSheet)\.ts"/.test(stmt);
      const xlsx = /from "npm:xlsx/.test(stmt);
      if (local || xlsx) continue;
      kept.push(stmt);
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

const google = stripImports(readFileSync("supabase/functions/sync-sheets/googleSheet.ts", "utf8"));
const parser = stripImports(readFileSync("supabase/functions/sync-sheets/shippingUpload.ts", "utf8"))
  .split("\n")
  .slice(5) // buang header "SALINAN OTOMATIS" milik versi multi-file
  .join("\n");
const handler = stripImports(readFileSync("supabase/functions/sync-sheets/index.ts", "utf8"));

const out = `// =============================================================================
// SINCRONISASI GOOGLE SHEET → SISTEM (versi SATU FILE)
// =============================================================================
// File ini dihasilkan otomatis oleh: npm run bundle:sync-fn
// JANGAN edit di sini — edit supabase/functions/sync-sheets/*.ts lalu jalankan ulang.
//
// Cara pakai (tanpa install apa pun):
//   Supabase Dashboard → Edge Functions → Create a new function
//   → Name: sync-sheets → Copas SELURUH isi file ini → Deploy
//
// Isi: helper unduh Google Sheet + parser dokumen pengiriman + handler HTTP.
// =============================================================================
import * as XLSX from "npm:xlsx@0.18.5";

// ============================== googleSheet.ts ==============================
${google}

// ============================ shippingUpload.ts =============================
${parser}

// ================================ index.ts ==================================
${handler}
`;

writeFileSync("docs/sync-sheets-standalone.ts", out);
console.log(`✓ bundled → docs/sync-sheets-standalone.ts (${(out.length / 1024).toFixed(1)} KB)`);
