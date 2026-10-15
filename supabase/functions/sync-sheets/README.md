# sync-sheets

Edge Function untuk menarik dokumen pengiriman dari **Google Sheet** ke sistem
otomatis (tanpa upload manual).

- `shippingUpload.ts` — **salinan** dari `src/lib/shippingUpload.ts`
  (hanya baris import `xlsx` yang berbeda). Dijaga tetap sinkron oleh tes
  `src/lib/__sheetSyncSame.test.ts` — jangan edit manual, jalankan
  `npm run sync:parser` setelah mengubah parser di `src/lib`.
- `googleSheet.ts` — unduh file Google Sheet sebagai XLSX.
- `index.ts` — handler HTTP: `test`, `preview`, `run`.

Lihat `docs/SHEET_SYNC.md` untuk cara deploy + penjadwalan (pg_cron).
