# Audit Sistem AssetFlow — Stok, Permintaan, dan Jejak Audit

**Tanggal audit:** 25 November 2026
**Cakupan:** seluruh alur persediaan (Barang Masuk/Keluar/Transfer/Opname), permintaan barang,
pengiriman, laporan stok (Live Stok, Asset Baru/Return/Unready, Kartu Stok, Pivot),
Log Transaksi, Peringatan Stok, dan Database (RPC, RLS, trigger, migrasi).

> **Catatan penting:** saya tidak punya akses ke database Supabase produksi Anda.
> Audit dilakukan dengan membaca **seluruh kode + 61 migrasi SQL**, lalu
> **menguji ulang mesin stok di PostgreSQL sungguhan** (PGlite) memakai skenario
> transaksi bertanggal lampau, stok minus, dan riwayat yang tidak sinkron.
> Angka stok Anda saat ini baru bisa dipastikan setelah migrasi di bagian
> **Cara menerapkan** dijalankan (ada query audit siap pakai di sana).

---

## 1. Ringkasan eksekutif

| Temuan | Jumlah |
|---|---|
| Bug/regresi diperbaiki pada sesi ini | **15** |
| Akar masalah utama "Stok Akhir ≠ Stok Awal + IN − OUT" | **4** |
| Tes otomatis | **342/342 lulus** (sebelumnya 4 gagal) |
| Build TypeScript | **lulus** |
| Butuh keputusan bisnis (belum diubah) | **6** |

**Intinya:** selama ini setiap halaman stok menghitung sendiri-sendiri dengan
**tiga sumber angka berbeda**, dan filter tanggalnya memakai **waktu input**
(`created_at`) bukan **tanggal transaksi**. Itu sebabnya Stok Awal, IN, OUT,
dan Stok Akhir tidak pernah bisa cocok — bukan karena stok fisiknya salah,
tetapi karena laporannya memakai campuran rumus dan tanggal yang berbeda.

Sekarang semua laporan stok memakai **satu rumus** (di database + fallback di
aplikasi) yang **selalu** memenuhi:

```
Stok Awal + IN − OUT = Stok Akhir
```

dan menyediakan **alat audit** untuk melihat serta membereskan selisih historis
tanpa mengubah stok fisik.

---

## 2. Akar masalah: kenapa Stok Akhir tidak sama dengan Stok Awal + IN − OUT

### 2.1 Tiga sumber angka yang dicampur

| Kolom laporan | Sumber lama | Masalah |
|---|---|---|
| **Stok Awal** | `inventory_balances.opening_qty` (angka dasar yang diedit manual) | Ini **stok awal dasar sepanjang riwayat**, bukan saldo awal periode. Kalau dipasangkan dengan IN/OUT satu bulan, hasilnya pasti tidak nyambung. |
| **IN / OUT** | `inventory_ledger` difilter `created_at` | `created_at` = **waktu input**. Pengiriman tanggal 10 Nov yang diunggah 11 Nov masuk ke tanggal 11 Nov. |
| **Stok Akhir** | `inventory_balances.qty` (saldo hari ini) | Untuk laporan bulan lalu, "Stok Akhir" menampilkan **saldo hari ini**, bukan saldo akhir bulan itu. |

Contoh nyata (halaman Asset Baru, 1–25 Nov):

```
Stok Awal (opening_qty) : 17
IN  (ledger Nov)        : 76
OUT (ledger Nov)        : 68
Stok Akhir (saldo live) : 6      ← 17 + 76 − 68 = 25, bukan 6
```

Selisih 19 itu **bukan** stok fisik hilang: 17 adalah angka dasar lama
sebelum beberapa penyesuaian, 76/68 dihitung menurut waktu input, dan 6
adalah saldo hari ini. Tiga hal berbeda dijejerkan seolah satu periode.

### 2.2 Stok Akhir periode lampau memakai saldo hari ini

Di **Live Stok**, apa pun tanggal akhir yang dipilih, kolom Stok Akhir selalu
`inventory_balances.qty` (saldo saat halaman dibuka). Laporan 1–10 November
menampilkan stok 25 November sebagai "Stok Akhir 10 November".

### 2.3 "Penyelamat" yang justru memutus persamaan

Live Stok lama menghitung `Stok Awal = Stok Akhir − IN + OUT`, lalu **kalau
hasilnya negatif** diganti `opening_qty`:

```ts
let awal = akhir - m.inQty + m.outQty;
if (awal < 0) awal = openingMap.get(key) ?? 0;   // ← persamaan langsung putus
```

Kasus CPU Rakitan (live 6, IN 76, OUT 68) menghasilkan −2, lalu ditimpa jadi 17.
Sejak itu `17 + 76 − 68 = 25 ≠ 6` selamanya, dan setiap laporan menampilkan
selisih yang tidak bisa dijelaskan.

### 2.4 Tidak ada alat deteksi selisih

Tidak ada satu pun tampilan/query yang memberi tahu bahwa
`saldo ≠ stok awal dasar + seluruh mutasi ledger`. Jadi selisih historis
(dari Atur Stok lama sebelum semua transaksi lewat buku besar) tidak pernah
terdeteksi, hanya "kelihatan aneh" di laporan.

---

## 3. Daftar temuan dan status

### 3.1 Stok & laporan (semua sudah diperbaiki)

| # | Modul | Masalah | Dampak | Status |
|---|---|---|---|---|
| S1 | Live Stok | Ledger difilter `created_at`, bukan `transaction_date` | Transaksi bertanggal lampau masuk periode yang salah | ✅ |
| S2 | Live Stok | Stok Akhir = saldo hari ini untuk periode lampau | Laporan bulan lalu tidak bisa dipakai | ✅ |
| S3 | Live Stok | Stok Awal negatif diganti `opening_qty` | Persamaan Awal+IN−OUT=AKhir tidak pernah benar | ✅ |
| S4 | Asset Baru/Return/Unready | Stok Awal = `opening_qty` (dasar) dicampur IN/OUT periode | Semua baris kelihatan selisih | ✅ |
| S5 | Asset Baru/Return/Unready | Ledger difilter `created_at` | Sama seperti S1 | ✅ |
| S6 | Kartu Stok (Laporan) | Filter tanggal memakai `created_at` | Kartu stok beda dengan Live Stok | ✅ |
| S7 | Semua laporan | Tidak ada alat audit selisih historis | Selisih tidak pernah ketahuan/dibereskan | ✅ |
| S8 | Live Stok | Tidak ada penanda baris yang riwayatnya tidak sinkron | User bingung, mengira bug baru | ✅ |

**Perbaikan:** satu mesin laporan `stock_period_report()` + `src/lib/stockPeriod.ts`
dengan rumus:

```
closing(D)       = saldo live − mutasi bertanggal > D
opening(periode) = closing − mutasi dalam periode
IN / OUT         = mutasi positif / negatif dalam periode
```

Semua diturunkan dari **satu** saldo live, jadi persamaan tidak mungkin putus —
termasuk untuk rentang tanggal lampau, satu hari, atau desimal (kg/meter).
Ditambah audit `stock_integrity()` + tombol **Selaraskan Stok Awal dasar**.

### 3.2 Permintaan & pengiriman (sudah diperbaiki)

| # | Modul | Masalah | Dampak | Status |
|---|---|---|---|---|
| P1 | Buat Permintaan | Info **sisa stok per kondisi hilang** dari form (regresi) | User mengajukan qty melebihi stok lokasi pemotong → kirim gagal | ✅ |
| P2 | Detail Permintaan (Review) | "Stok tersedia" = **total semua lokasi** (Baru+Retur+Unready) | Menyetujui qty yang tidak ada di lokasi pemotong → kirim gagal | ✅ |
| P3 | Detail Permintaan (Kirim) | Dropdown "lokasi gudang pengirim" **diabaikan** RPC (lokasi ditentukan Status Asset) | Admin memilih STOK-BARU, stok dipotong dari STOK-RETUR; membingungkan | ✅ |
| P4 | Detail Permintaan (Kirim) | Tidak ada peringatan stok lokasi pemotong per baris | Error baru muncul setelah klik Kirim | ✅ |
| P5 | Log Transaksi | Kolom "Status Asset" memakai lokasi ledger, bukan `status_aset` transaksi | Setelah koreksi jenis stok, log menampilkan status lama | ✅ |
| P6 | Log Transaksi | Tidak ada penanda "Koreksi stok tercatat" | Jejak audit koreksi tidak terlihat | ✅ |
| P7 | Kirim Cepat (Super Admin) | `qty_approved` diturunkan menjadi qty kirim, lalu baris ditandai `terkirim` | **Sisa permintaan hilang** dari "Sisa Belum Terkirim" bila qty kirim < permintaan | ✅ (migrasi `20261125000002`) |

### 3.3 Peringatan stok & dashboard (sudah diperbaiki)

| # | Modul | Masalah | Dampak | Status |
|---|---|---|---|---|
| A1 | Peringatan Stok | Stok dihitung total semua kondisi (Baru+Retur+Unready) | Barang "aman" padahal stok siap pakai 0 → kirim gagal | ✅ |
| A2 | Dashboard | "Stok menipis" memakai total semua kondisi | Angka dashboard beda dengan halaman peringatan | ✅ |

Sekarang peringatan berbasis **stok siap pakai (lokasi `*-BARU`)**, dengan total
semua kondisi tetap ditampilkan sebagai konteks.

### 3.4 Tanggal & zona waktu (sudah diperbaiki)

| # | Modul | Masalah | Dampak | Status |
|---|---|---|---|---|
| T1 | Buat Permintaan, Transaksi, PO, Dashboard | Tanggal default memakai `toISOString()` (UTC) | Antara 00:00–07:00 WIB tanggalnya **kemarin** → transaksi tercatat di tanggal salah | ✅ |
| T2 | Input tanggal transaksi (Barang Masuk/Keluar/Transfer, Kartu Stok, Permintaan) | Tidak ada batas tanggal maksimum | Salah ketik tahun (2027) membuat stok "hilang" dari laporan sampai tanggal itu tiba | ✅ (`max` = hari ini; tanggal lampau tetap boleh) |

Ditambahkan `todayLocalDate()` di `src/lib/format.ts` dan dipakai pada
titik-titik tanggal bisnis.

### 3.5 Kualitas kode (sudah diperbaiki)

| # | Masalah | Status |
|---|---|---|
| Q1 | 4 tes otomatis merah (fitur sisa stok & status aset hilang) | ✅ 342/342 lulus |
| Q2 | Tidak ada tes untuk matematika stok | ✅ tes unit + tes PostgreSQL (PGlite) |

---

## 4. Yang belum diperbaiki (butuh keputusan bisnis Anda)

Ini bukan bug yang bisa saya putuskan sendiri karena mengubah kebijakan operasional.

| # | Temuan | Risiko | Rekomendasi |
|---|---|---|---|
| R1 | **Upload Dokumen → opsi "Jangan kurangi stok"** menaikkan `qty_shipped` dan menandai `terkirim` **tanpa** menulis ledger | Stok tidak pernah keluar; permintaan "selesai" tetapi stok gudang tetap | Pakai hanya untuk migrasi data lama; beri label "hanya catat dokumen (stok TIDAK dipotong)" + wajib alasan, atau matikan opsi ini |
| R2 | **Stok minus diizinkan** (`p_allow_negative`) pada upload massal & koreksi | Laporan menampilkan saldo negatif | Tetap boleh untuk import, tetapi jalankan **Stock Opname** rutin; halaman audit baru sudah menandai baris bermasalah |
| R3 | **Hapus log transaksi** (void / admin purge) **menghapus baris ledger** | Jejak audit per item hilang; laporan periode lama berubah | Batasi ke transaksi hari yang sama, wajib alasan, dan simpan snapshot ke `audit_logs` sebelum hapus |
| R4 | **Status Request** (PENAMBAHAN/PERGANTIAN/PINJAM) disimpan sebagai teks di `notes` | Rapuh: parsing teks, tidak bisa difilter/divalidasi database | Tambah kolom `request_items.status_request` + backfill dari `notes`, lalu simpan langsung |
| R5 | **Sinkron Google Sheet** sedang nonaktif di konfigurasi (commit terakhir: `spreadsheet_id` eksplisit, sumber sinkronisasi nonaktif) | Data pengiriman tidak masuk otomatis | Aktifkan kembali + `setup_cron.sql`, atau tetap pakai Upload Dokumen |
| R6 | **Tidak ada backup terjadwal/peringatan** di repo | Risiko kehilangan data | Aktifkan backup harian Supabase + uji restore (lihat `docs/DATABASE.md` §10) |
| R7 | **Rate/volume**: fallback laporan (bila migrasi belum jalan) membaca seluruh ledger di browser | Lambat pada data sangat besar | **Jalankan migrasi** → laporan memakai RPC (agregasi di database) |

---

## 5. Perubahan teknis pada sesi ini

### Database
- **`supabase/migrations/20261125000001_stock_consistency.sql`** (baru)
  - `stock_period_report(lokasi[], mulai, akhir)` — satu-satunya rumus laporan
    stok; selalu rekonsiliasi; memakai `transaction_date`.
  - `stock_integrity(lokasi[])` — daftar baris yang
    `saldo ≠ stok awal dasar + ledger` beserta nilai selisih.
  - `align_stock_opening_baselines(lokasi[])` — Super Admin menyelaraskan
    **stok awal dasar** (stok fisik & transaksi tidak diubah) + jejak `audit_logs`.
  - Index baru `idx_ledger_loc_item`, `idx_txn_date_id`.
- **`supabase/migrations/20261125000003_stock_console_access.sql`** (baru)
  - `_stock_console_read()` + izin baca untuk sesi SQL Editor; role API tetap
    wajib `inventory.view`.
- **`supabase/migrations/20261125000002_quick_ship_partial.sql`** (baru)
  - `quick_ship_request()`: `qty_approved = GREATEST(qty_requested, qty_kirim)`,
    sehingga sisa pengiriman tidak hilang dan tetap masuk "Sisa Belum Terkirim".
- Salinan siap-copas: **`docs/sql/stock_consistency.sql`**,
  **`docs/sql/quick_ship_partial.sql`**, **`docs/sql/stock_console_access.sql`**
  (identik dengan migrasinya), plus **`docs/sql/verify_stock_migration.sql`**.

### Aplikasi
- **`src/lib/stockPeriod.ts`** (baru) — mesin hitung yang sama untuk klien +
  loader yang memakai RPC, dengan **fallback** bila migrasi belum dijalankan.
- **`src/lib/format.ts`** — `todayLocalDate()` (tanggal bisnis, bukan UTC).
- **`src/pages/LiveStockPage.tsx`** — memakai mesin baru; panel audit selisih +
  tombol Selaraskan (Super Admin); penanda baris tidak sinkron.
- **`src/pages/StokKondisiPage.tsx`** — memakai mesin baru; dialog "Ubah"
  memakai **stok awal dasar** (bukan saldo awal periode) dan menjelaskannya.
- **`src/pages/ReportsPage.tsx`** — Kartu Stok difilter `transaction_date`.
- **`src/pages/RequestFormPage.tsx`** — sisa stok Baru/Retur/Unready +
  peringatan "melebihi stok lokasi pemotong"; tombol Tambah Baris di bawah daftar.
- **`src/pages/RequestDetailPage.tsx`** — review & kirim memakai stok per
  lokasi pemotong; lokasi potong ditampilkan per baris; validasi sebelum kirim.
- **`src/pages/StockAlertsPage.tsx`**, **`src/pages/DashboardPage.tsx`** —
  peringatan berbasis stok siap pakai (`*-BARU`).
- **`src/pages/TransactionLogPage.tsx`** — status asset efektif (transaksi →
  fallback permintaan) + penanda "Koreksi stok tercatat".
- **`src/pages/RequestFormPage.tsx`**, **`StokKondisiPage.tsx`**,
  **`PurchaseOrderFormPage.tsx`**, **`DashboardPage.tsx`** — tanggal lokal.
- **`TransactionForm.tsx`**, **`KartuStokPage.tsx`**, **`RequestFormPage.tsx`** —
  tanggal transaksi dibatasi maksimum hari ini (cegah salah ketik tahun).

### Tes
- **`src/lib/stockPeriod.test.ts`** — 9 tes matematika stok.
- **`src/lib/stockPeriod.db.test.ts`** — 7 tes PostgreSQL/PGlite (rekonsiliasi,
  periode lampau, selisih historis, penyelarasan, guard izin).
- **`src/features/requests/quickShip.db.test.ts`** — 2 tes PostgreSQL/PGlite
  (kirim sebagian tidak menghilangkan sisa; pelunasan menandai terkirim).
- **`src/lib/verifyStockSql.db.test.ts`** — 5 tes yang menjalankan skrip
  `docs/sql/verify_stock_migration.sql` apa adanya, sehingga skrip cek di
  Supabase dijamin tidak error dan hasilnya akurat.

---

## 6. Cara menerapkan (wajib, ±5 menit)

### Langkah 1 — Backup (2 menit)
Supabase Dashboard → **Database → Backups** → pastikan ada backup terbaru
(atau `pg_dump`, lihat `docs/DATABASE.md` §10).

### Langkah 2 — Jalankan migrasi (1 menit)
**Cara memastikan SQL-nya sudah aktif:** buka Supabase → SQL Editor → tempel
seluruh isi **`docs/sql/verify_stock_migration.sql`** → Run. Hasilnya satu tabel
10 baris; semua harus **LULUS** (baris "PERHATIAN" hanya menandai data lama
yang perlu diselaraskan, bukan error). Di aplikasi, panel Live Stok juga
menampilkan tulisan "✓ Mesin laporan SQL aktif" bila migrasi terpasang, atau
"⚠ … mode kompatibilitas" bila belum.

Catatan penting: **SQL Editor tidak punya JWT**, sehingga `auth.uid()` = NULL
dan `has_permission()` selalu false. Karena itu fungsi baca stok menolak
dipanggil dari SQL Editor ("Tidak punya izin melihat stok") walaupun sudah
terpasang — bukan tanda migrasi gagal. Migrasi `20261125000003` memberi izin
baca khusus sesi konsol DB (role API tetap wajib `inventory.view`), supaya
`SELECT * FROM stock_integrity();` bisa dijalankan manual.

Supabase Dashboard → **SQL Editor** → jalankan **kedua** file berikut:

1. `supabase/migrations/20261125000001_stock_consistency.sql`
   (atau `docs/sql/stock_consistency.sql`)
2. `supabase/migrations/20261125000002_quick_ship_partial.sql`
   (atau `docs/sql/quick_ship_partial.sql`)
3. `supabase/migrations/20261125000003_stock_console_access.sql`
   (atau `docs/sql/stock_console_access.sql`) — agar fungsi baca bisa
   diuji dari SQL Editor

Aman dijalankan berulang (`CREATE OR REPLACE` / `IF NOT EXISTS`).

### Langkah 3 — Deploy aplikasi
Merge branch ini ke `main` (Vercel auto-deploy), lalu **hard refresh** (Ctrl+Shift+R).

> Selama migrasi belum dijalankan, aplikasi tetap jalan memakai perhitungan
> fallback (lebih lambat) — jadi urutan langkah 2 dan 3 tidak wajib berurutan.

### Langkah 4 — Lihat hasil audit stok
Buka **Persediaan → Live Stok** → pilih gudang → **Tampilkan**.
Kalau muncul panel kuning "N baris punya selisih historis":

- Angka laporan **sudah seimbang** (Stok Awal + IN − OUT = Stok Akhir).
- Untuk merapikan **stok awal dasar** agar cocok dengan seluruh riwayat,
  klik **Selaraskan Stok Awal dasar** (Super Admin). Stok fisik, IN, OUT, dan
  semua transaksi **tidak berubah**; hanya angka dasar "Stok Awal" yang
  disesuaikan dan tercatat di **Audit Log**.

Query audit manual (SQL Editor):

```sql
SELECT * FROM public.stock_integrity();          -- semua lokasi
-- atau per gudang:
SELECT si.*
  FROM public.stock_integrity() si
  JOIN public.locations l ON l.id = si.location_id
  JOIN public.warehouses w ON w.id = l.warehouse_id
 WHERE w.name = 'Gudang Utama';
```

### Langkah 5 — Verifikasi cepat
1. **Live Stok**, gudang yang sama, 1–hari ini → jumlahkan per baris:
   `Stok Awal + IN − OUT` harus **sama persis** dengan `Stok Akhir`.
2. Ganti periode ke bulan lalu → **Stok Akhir berubah** (saldo akhir periode
   itu, bukan saldo hari ini).
3. **Asset Baru** dan **Log Transaksi** untuk barang yang sama → IN/OUT
   konsisten dengan Live Stok.
4. **Peringatan Stok** → item dengan stok Baru 0 dan Retur > 0 sekarang
   muncul **Kritis** (dulu dianggap aman).

---

## 7. Skenario uji manual yang disarankan

| Skenario | Harapan |
|---|---|
| Pengiriman tanggal 10 Nov diunggah 11 Nov | Masuk periode **10 Nov** di semua laporan |
| Laporan 1–10 Nov dibuka 25 Nov | Stok Akhir = saldo 10 Nov (bukan saldo hari ini) |
| Kirim barang ASSET RETUR dari tiket | Stok dipotong dari **STOK-RETUR**, bukan STOK-BARU |
| Kirim Cepat dengan qty lebih kecil dari permintaan | Sisa otomatis muncul di **Sisa Belum Terkirim** (tidak hilang) |
| Review tiket: stok Baru 10, Retur 0, minta ASSET RETUR 5 | Panel review menunjukkan tersedia **0 (STOK-RETUR)**, bukan 10 |
| Atur Stok Awal di Asset Baru | Stok Akhir bergerak sebesar selisih; IN/OUT tidak berubah |
| Koreksi jenis stok di Log Transaksi | Detail menampilkan status baru + "Koreksi stok tercatat" |
| Buat permintaan pukul 06:00 WIB | Tanggal default = **hari ini** (bukan kemarin) |
| Barang stok Baru 0, Retur 5, min 2 | Muncul **Kritis** di Peringatan Stok & ikut dihitung dashboard |

---

## 8. Rekomendasi prioritas berikutnya

1. **R1 + R2 (paling mendesak):** putuskan kebijakan "upload tanpa potong stok"
   dan jalankan **Stock Opname** untuk semua baris yang masih bersaldo negatif
   (`docs/sql/cek_saldo_negatif.sql`).
2. **R3:** ubah hapus log menjadi "void beraudit" (snapshot + alasan) agar
   laporan periode lama tidak berubah diam-diam.
3. **R4:** pindahkan Status Request dari `notes` ke kolom database.
4. **R5:** aktifkan kembali sinkron Google Sheet + cron, atau resmikan Upload
   Dokumen sebagai satu-satunya jalur.
5. **Monitoring:** jalankan `SELECT count(*) FROM stock_integrity();` mingguan
   (atau jadikan cron) — kalau > 0, ada perubahan stok di luar buku besar.
6. **Test:** tambah tes E2E untuk alur kirim (review → kirim → cek ledger) di
   staging dengan Supabase asli.

---

## 9. Batasan audit ini

- Tidak ada akses ke data produksi: selisih **per barang** baru terlihat setelah
  Langkah 4 dijalankan.
- Migrasi lama di repo dipertahankan apa adanya (prinsip: jangan edit migrasi
  yang sudah jalan di production); semua perbaikan ditambahkan sebagai migrasi
  baru `20261125000001`.
- Perbaikan UI diuji lewat unit/DB test + type-check; verifikasi visual akhir
  tetap perlu dilakukan di browser setelah deploy.
