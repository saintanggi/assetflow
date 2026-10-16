# Sinkronisasi Otomatis dari Google Sheet

Tim mengisi dokumen pengiriman di Google Sheet (satu **sheet per tanggal**, mis.
`13 OKT`, `14 OKT`). Dengan fitur ini data itu **masuk ke sistem otomatis** — tidak
perlu download → upload manual.

Aturan yang dipakai (sama dengan template dokumen pengiriman):

| Aturan | Perilaku sistem |
|---|---|
| Sheet yang dibaca | **Selalu sheet terbaru** (nama bertanggal, mis. `14 OKT`). Sheet lama & `Copy of …` diabaikan. |
| Kolom `QTY` yang di-merge | Angka itu = **total satu blok barang**, dibagi ke baris-barisnya (mis. 23 baris KURSI TRAINING dengan QTY 23 → 23 unit, bukan 45). |
| `STATUS ASSET` | Menentukan stok yang dipotong: `ASSET BARU → STOK-BARU`, `ASSET RETUR/RETURN → STOK-RETUR`, `ASSET UNREADY → STOK-UNREADY`. |
| `STATUS TERKIRIM` | `PENDING` → masuk dashboard *Sisa Belum Terkirim* (stok tidak dipotong). |
| Baris tanpa `NO TICKET` | Dibuat permintaan otomatis `UPL-<tanggal>-n` per barang. |
| Nama barang tidak ada di master | Dilewati + dilaporkan, atau dibuat otomatis bila opsi **Buat barang baru otomatis** aktif. |
| Dijalankan berulang | Aman (idempoten): baris yang sudah pernah masuk dikenali dari tiket + tanggal + barang + barcode/resi. |

---

## 1. Prasyarat

1. **Sharing file Google Sheet**: `Bagikan` → `Siapa saja yang memiliki link` → **Pelihat**.
   (Kalau tidak, fungsi akan menjawab: *“File Google Sheet tidak bisa diunduh …”*.)
2. Migrasi baru sudah dijalankan di Supabase:
   - `20261015000029_sheet_sync.sql` — tabel konfigurasi + riwayat.
   - `20261015000030_sheet_sync_functions.sql` — fungsi `sync_ship_request_items`
     (memakai hak `service_role`, karena Edge Function berjalan tanpa user login).
   - `20261016000034_fix_sync_ship_asset_condition.sql` — pastikan pengiriman manual maupun
     sinkronisasi campuran ASSET BARU/RETURN/UNREADY dipotong dari lokasi dan dicatat per
     jenis aset yang benar. Fungsi akan gagal dengan jelas bila lokasi kondisi belum ada,
     bukan fallback memotong stok kondisi lain.
   - `20261016000035_admin_delete_request_and_transaction.sql` — penghapusan permintaan atau
     transaksi oleh Super Admin menghapus ledger terkait dan mengembalikan saldo bersih tanpa
     membuat transaksi IN/OUT pembalik.
   - `20261016000036_fix_admin_correct_txn_item_idempotent.sql` — pastikan koreksi jenis aset
     langsung terlihat di Log Transaksi dan koreksi berulang tidak membuat transfer stok ganda.

   Untuk deployment yang dikelola lewat Dashboard SQL Editor, salinan migration tersedia di
   `docs/sql/fix_sync_ship_asset_condition.sql`,
   `docs/sql/admin_delete_request_and_transaction.sql`, dan
   `docs/sql/fix_admin_correct_txn_item.sql`. Untuk memeriksa transaksi lama tanpa
   mengubah data, jalankan `docs/sql/audit_asset_condition_mismatch.sql`; koreksi kandidat
   melalui aksi pensil di Log Transaksi sebagai Super Admin agar penyesuaian stok tercatat
   sebagai transaksi transfer audit. Migration perbaikan status memperbaiki transaksi baru,
   bukan histori transaksi lama.

## 2. Deploy Edge Function

**Cara paling mudah (tanpa install)** — Supabase Dashboard → **Edge Functions** →
**Create a new function** → Name: `sync-sheets` → hapus isi editor → copas seluruh isi
**`docs/sync-sheets-standalone.ts`** → **Deploy** (biarkan *Enforce JWT Verification* ON).

**Atau dengan CLI:**

```bash
supabase link --project-ref <PROJECT-REF>
supabase functions deploy sync-sheets      # JWT verification tetap aktif (default)
```

JWT verification tetap boleh aktif karena cron mengirim **service-role key** (itu JWT
yang valid). Untuk panggilan dari aplikasi, fungsi memeriksa sendiri: harus lolos
`has_permission('settings.manage')` / super admin.

> Panduan klik-per-klik untuk pengguna non-teknis ada di **`PANDUAN-SETUP-SINKRON.md`**
> (termasuk file SQL siap copas di `docs/sql/`).

## 3. Atur sumber di aplikasi

Buka **Permintaan → Upload Dokumen Pengiriman**, panel **Sinkron Google Sheet** di
kanan:

1. Tempel link file, mis. `https://docs.google.com/spreadsheets/d/…/edit`.
2. **Tes koneksi** → muncul nama sheet terbaru yang akan dipakai.
3. Atur opsi (kurangi stok / izinkan minus / buat barang otomatis).
4. **Simpan sumber**, lalu **Pratinjau** (lihat qty per barang) dan **Sinkron sekarang**.

## 4. Jadwalkan tiap 15 menit (pg_cron)

File siap copas: **`docs/sql/setup_cron.sql`** (ganti 2 placeholder di dalamnya).
Jalankan di **SQL Editor** Supabase. **Jangan** commit kunci ini ke repo.

```sql
-- sekali saja
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'sync-google-sheet-pengiriman',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://<PROJECT-REF>.supabase.co/functions/v1/sync-sheets',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer <SERVICE-ROLE-KEY>'
               ),
    body    := jsonb_build_object('action', 'run')
  ) AS request_id;
  $$
);
```

Cek & kelola jadwal:

```sql
SELECT * FROM cron.job;
SELECT status, return_message, start_time FROM cron.job_run_details
ORDER BY start_time DESC LIMIT 10;
SELECT cron.unschedule('sync-google-sheet-pengiriman');   -- bila ingin berhenti
```

> Alternatif tanpa `pg_cron`: pakai *Supabase Dashboard → Edge Functions → Schedules*,
> atau cron eksternal yang memanggil URL fungsi yang sama.

## 5. Memantau

- Panel **Sinkron Google Sheet** menampilkan eksekusi terakhir + 5 riwayat terakhir.
- Tabel `sheet_sync_runs` menyimpan detail tiap eksekusi (jumlah permintaan, unit,
  baris duplikat yang dilewati, pesan kegagalan, 20 kegagalan pertama).

```sql
SELECT started_at, sheet_name, status, requests_created, qty_imported, message
FROM public.sheet_sync_runs ORDER BY started_at DESC LIMIT 20;
```

- Permintaan hasil sinkronisasi punya catatan `notes = 'Sinkron Google Sheet otomatis (<sheet>)'`,
  dan view `v_sheet_sync_recent` menampilkan ringkasannya.

## 6. Troubleshooting

| Gejala | Sebab & solusi |
|---|---|
| `File Google Sheet tidak bisa diunduh` | Sharing bukan “Siapa saja yang memiliki link → Pelihat”. |
| `Hanya Super Admin (settings.manage)…` | Akun yang dipakai tidak punya hak; pakai akun super admin. |
| `Fungsi sync-sheets belum di-deploy` | Belum `supabase functions deploy sync-sheets --no-verify-jwt`. |
| `Lokasi STOK-BARU belum ada` | Jalankan migrasi lokasi (0010/0012). |
| `N nama barang belum ada di master` | Tambah di Master Barang atau aktifkan *Buat barang baru otomatis*. |
| Qty terlihat aneh | Buka **Pratinjau**: kolom Catatan menunjukkan asal angka (`QTY file 23 untuk 23 baris`, `dihitung 6 dari 6 baris`, dst). |
| Ingin kembali ke upload manual | Matikan jadwal cron (`cron.unschedule`) — panel tetap bisa dipakai manual. |

## 7. Berkas terkait

| Berkas | Isi |
|---|---|
| `PANDUAN-SETUP-SINKRON.md` | Panduan klik-per-klik (untuk non-teknis) |
| `docs/sql/setup_sheet_sync.sql` | Dua migrasi (20261015000029 + 20261015000030) digabung, 1x copas |
| `docs/sql/setup_cron.sql` | Jadwal `pg_cron` tiap 15 menit, tinggal ganti 2 placeholder |
| `docs/sync-sheets-standalone.ts` | Edge Function versi satu file untuk di-paste di Dashboard |
| `scripts/sync-parser.mjs` / `scripts/bundle-sync-fn.mjs` | Regenerasi salinan parser & bundle (`npm run sync:parser`, `npm run bundle:sync-fn`) |

## 8. Catatan teknis

- Parser di Edge Function adalah **salinan** `src/lib/shippingUpload.ts`
  (`supabase/functions/sync-sheets/shippingUpload.ts`). Setelah mengubah parser,
  jalankan `npm run sync:parser`; tes `src/lib/__sheetSyncSame.test.ts` akan gagal
  bila kedua file berbeda.
- Fungsi `sync_ship_request_items(p_request_id, p_location_id, p_lines, p_notes, p_allow_negative)`
  isinya identik dengan `ship_request_items`, hanya menambah izin `service_role`
  (Edge Function tidak punya `auth.uid()`).
- Fungsi HTTP: `{action:"test"}` · `{action:"preview"}` · `{action:"run"}`
  (opsional: `source_id`, `spreadsheet_id`, `sheet_mode`, `sheet_name`,
  `deduct_stock`, `allow_negative`, `auto_create_items`).
  Tanpa parameter apa pun (khusus cron) semua sumber aktif dijalankan.
