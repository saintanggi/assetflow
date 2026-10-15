// Regenerasi COPAS-KE-SUPABASE.md: satu file berisi 3 script siap copas ke Supabase
// (BLOK A = SQL migrasi, BLOK B = Edge Function 1 file, BLOK C = jadwal pg_cron).
// Pakai: npm run copas
import { readFileSync, writeFileSync } from "node:fs";

const sql = readFileSync("docs/sql/setup_sheet_sync.sql", "utf8").trimEnd() + "\n";
const cron = readFileSync("docs/sql/setup_cron.sql", "utf8").trimEnd() + "\n";
const fn = readFileSync("docs/sync-sheets-standalone.ts", "utf8").trimEnd() + "\n";
const lines = (s) => s.trimEnd().split("\n").length;

const head = `# 📋 COPAS KE SUPABASE — 3 SCRIPT SIAP PAKAI

> File ini dibuat supaya Anda **tidak perlu mencari-cari lagi**. Isinya **3 script**:
> **BLOK A** (Langkah 1), **BLOK B** (Langkah 2), dan **BLOK C** (Langkah 4).
> Cara pakai: pilih script yang sesuai langkah → **Ctrl+A lalu Ctrl+C di dalam kotak itu saja**
> (dari kata \`COPAS MULAI\` sampai \`COPAS SELESAI\`) → paste ke Supabase → klik Run/Deploy.
>
> Panduan klik-per-klik lengkapnya: **\`PANDUAN-SETUP-SINKRON.md\`**.
> Cara memastikan sinkron benar-benar jalan: **\`CEK-SINKRON.md\`**.

| Blok | Dipakai di langkah | Ditempel di | Ukuran |
|---|---|---|---|
| **BLOK A** — tabel & fungsi database | Langkah 1 | Supabase → **SQL Editor** → New query → Run | ${lines(sql)} baris |
| **BLOK B** — mesin sinkron (Edge Function) | Langkah 2 | Supabase → **Edge Functions** → Create function \`sync-sheets\` → Deploy | ${lines(fn)} baris |
| **BLOK C** — jadwal otomatis tiap 15 menit | Langkah 4 | Supabase → **SQL Editor** → New query → Run (ganti 2 tulisan dulu) | ${lines(cron)} baris |

**Alur singkat:** A dulu → B → (buka aplikasi: Tes koneksi, Simpan, Pratinjau, Sinkron sekarang) → C → Merge PR #4 → cek di \`CEK-SINKRON.md\`.

---
---

# 🟦 BLOK A — untuk LANGKAH 1 (Supabase → SQL Editor)

**Cara:** Supabase Dashboard → pilih project → menu kiri **\`</>\` SQL Editor** → **\`+ New query\`** → copas semua di bawah ini → klik **\`Run\`**.
**Harus muncul:** \`Success. No rows returned\`. (Aman diulang, tidak merusak data.)

<!-- COPAS MULAI (BLOK A) -->
\`\`\`sql
${sql}\`\`\`
<!-- COPAS SELESAI (BLOK A) -->

---
---

# 🟩 BLOK B — untuk LANGKAH 2 (Supabase → Edge Functions)

**Cara:** Supabase Dashboard → menu kiri **\`Edge Functions\`** → **\`Create a new function\`** → Name: **\`sync-sheets\`** → hapus semua contoh kode yang muncul → copas semua di bawah ini → biarkan **Enforce JWT Verification tetap ON** → klik **\`Deploy\`** → tunggu status **Deployed**.
**Catatan:** kalau di editor muncul garis merah/kuning, **abaikan saja** — itu normal untuk file besar; yang penting Deploy berhasil.
**Kalau Langkah 2 sudah pernah Anda kerjakan sebelumnya:** klik fungsi \`sync-sheets\` → **Edit** → hapus semua → paste ulang isi terbaru di bawah → **Deploy** (supaya perbaikan tanggal baris tanpa tanggal ikut terpakai).

<!-- COPAS MULAI (BLOK B) -->
\`\`\`ts
${fn}\`\`\`
<!-- COPAS SELESAI (BLOK B) -->

---
---

# 🟨 BLOK C — untuk LANGKAH 4 (Supabase → SQL Editor)

**Cara:** Supabase → SQL Editor → New query → copas di bawah ini → **ganti 2 tulisan dulu** → Run.

Ganti ini dulu sebelum Run:

| Tulisan | Diganti dengan | Lihat di |
|---|---|---|
| \`<PROJECT-REF>\` | Reference ID project | Project Settings → General → Reference ID |
| \`<SERVICE-ROLE-KEY>\` | kunci service_role | Project Settings → API Keys → service_role (tulisan *secret*) |

> ⚠️ Kunci itu rahasia — jangan kirim ke siapa pun. Cukup paste di kolomnya, jangan simpan di chat/WA.

<!-- COPAS MULAI (BLOK C) -->
\`\`\`sql
${cron}\`\`\`
<!-- COPAS SELESAI (BLOK C) -->

---
---

## ✅ Checklist setelah selesai

- [ ] **Langkah 1** — BLOK A di Run → muncul \`Success. No rows returned\`
- [ ] **Langkah 2** — BLOK B di Deploy → status *Deployed* di \`sync-sheets\`
- [ ] **Langkah 3** — Di aplikasi, panel **Sinkron Google Sheet**: Tes koneksi **hijau** → Simpan → Pratinjau (barang contoh **KURSI TRAINING = 23**) → Sinkron sekarang
- [ ] **Langkah 4** — BLOK C (sudah diganti 2 tulisan) di Run → muncul \`Success\` + \`cron.job\` → \`active = true\`
- [ ] **Cek** — query di \`CEK-SINKRON.md\`: konfigurasi ≥ 1, status \`sukses\`, kode HTTP \`200\`
- [ ] **Langkah 5** — Merge PR #4 di GitHub

Kalau ada tulisan merah / error di salah satu langkah → screenshot lalu kirim. Tulis juga langkah berapa.
`;

writeFileSync("COPAS-KE-SUPABASE.md", head);
console.log("COPAS-KE-SUPABASE.md:", Math.round(head.length / 1024), "KB");
