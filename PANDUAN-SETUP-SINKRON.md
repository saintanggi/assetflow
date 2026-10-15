# PANDUAN SETUP SINKRON OTOMATIS — DARI GOOGLE SHEET KE SISTEM

> Panduan ini untuk yang **tidak terbiasa dengan teknis**. Ikuti urutannya, jangan
> dilompati. Total waktu ±15 menit. Kalau ada langkah yang bingung atau error,
> screenshot saja layarnya lalu kirim ke saya.

**Hasil akhirnya:** begitu tim mengisi sheet tanggal baru di Google Sheet
(mis. sheet `15 OKT`), datanya **masuk sendiri** ke sistem tiap 15 menit — tanpa
perlu upload, tanpa perlu buka aplikasi. Qty-nya sudah benar (aturannya sama dengan
template: satu angka QTY yang di-merge = total satu blok barang), dan stok dipotong
sesuai kolom `STATUS ASSET` (ASSET BARU → stok Baru, ASSET RETUR → stok Retur,
UNREADY → stok Unready).

---

## ✅ LANGKAH 0 — Sudah beres (saya kerjakan dari sini)

- **Sharing file Google Sheet**: file `DOKUMEN PENGIRIMAN 2026` sudah di-set
  **“Siapa saja yang memiliki link”** → jadi sistem boleh membacanya otomatis.
  *(Saat saya cek, haknya bahkan “Editor”. Kalau mau saya turunkan jadi “Pelihat”
  biar lebih aman — semua orang yang punya link cuma bisa lihat, tidak bisa
  mengubah — bilang saja “turunkan jadi pelihat”.)*
- **Kode**: perbaikan qty + fitur sinkron sudah di branch PR #4. Kamu perlu klik
  **Merge** di PR itu supaya masuk ke aplikasi (lihat Langkah 4 di bawah).

---

## LANGKAH 1 — Jalankan SQL (1x copas) — ±3 menit

Ini membuat “meja kerja” tempat sistem mencatat konfigurasi & riwayat sinkronisasi.

1. Buka **https://supabase.com/dashboard** lalu login.
2. Klik **project** aplikasi inventaris kamu (kalau punya beberapa, pilih yang
   dipakai aplikasi AssetFlow).
3. Di menu kiri cari ikon **`</>` SQL Editor**, klik.
4. Klik tombol **`+ New query`** (kanan atas).
5. Buka file ini di komputer/repo kamu:
   **`docs/sql/setup_sheet_sync.sql`**
   → **copas SELURUH isinya** (dari baris pertama sampai terakhir) → tempel di kotak
   SQL Editor yang tadi.
6. Klik tombol **`Run`** (kanan bawah, atau tekan `Ctrl+Enter`).
7. Kalau berhasil muncul tulisan **“Success. No rows returned”** — artinya beres. 👍
   (Kalau muncul tulisan merah, screenshot dan kirim ke saya — jangan diulang-ulang.)

> Aman dijalankan 2x, tidak akan merusak data yang sudah ada.

---

## LANGKAH 2 — Buat “mesin” sinkronisasi (Edge Function) — ±5 menit

Mesin ini yang tugasnya: buka Google Sheet → baca **sheet terbaru** → masukkan ke sistem.

**Pilih cara A (tanpa install, disarankan) atau cara B (pakai terminal).**

### ✅ Cara A — lewat Supabase Dashboard (tanpa install apa pun)

1. Di Supabase Dashboard project kamu, klik menu kiri **`Edge Functions`**
   (kalau tidak kelihatan, klik **More** / cari di daftar menu).
2. Klik **`Create a new function`** (atau **Deploy a new function → Via Editor**).
3. **Name** isi persis: **`sync-sheets`** (huruf kecil semua, pakai tanda minus).
4. Akan muncul editor kode berisi contoh fungsi. **Hapus semua isinya**
   (`Ctrl+A` lalu `Delete`).
5. Buka file di repo: **`docs/sync-sheets-standalone.ts`**
   → **copas SELURUH isinya** → tempel ke editor tadi.
6. Pastikan **“Enforce JWT Verification”** / **“Verify JWT”** tetap **ON/Aktif**
   (bawaan). Ini aman karena penjadwal nanti mengirim kunci service.
7. Klik **`Deploy`**. Tunggu sampai status **Deployed / Active** (±1 menit).
8. Salin **URL fungsi** yang muncul — bentuknya:
   `https://<PROJECT-REF>.supabase.co/functions/v1/sync-sheets`
   → simpan dulu di Notepad, nanti dipakai di Langkah 3.

### 🧰 Cara B — pakai terminal (kalau kamu nyaman dengan command line)

```bash
# sekali saja per komputer
npm install -g supabase
supabase login            # akan membuka browser untuk login
cd <folder repo assetflow>
supabase link --project-ref <PROJECT-REF>
supabase functions deploy sync-sheets
```

> Kalau kamu tidak tahu `<PROJECT-REF>`: Supabase Dashboard → **Project Settings →
> General** → **Reference ID**.

---

## LANGKAH 3 — Sambungkan aplikasi ke Sheet (dari dalam aplikasi) — ±3 menit

1. Buka aplikasi AssetFlow → login sebagai **Super Admin**.
2. Menu **Permintaan → Upload Dokumen Pengiriman**.
3. Di kolom kanan ada panel **“Sinkron Google Sheet”**:
   1. Tempel **link Google Sheet** kamu di kotak pertama
      (buka sheet-nya → klik Share/Copy link; boleh link panjang, sistem ambil ID-nya sendiri).
      Contoh: `https://docs.google.com/spreadsheets/d/1-Z3bvCFo49zao5-M8lnVp4lxPdTbuzPhN9NcqL5TWCE/edit`
   2. Dropdown **“Sheet yang dipakai”** → biarkan **“Selalu sheet terbaru”**.
   3. Centang **“Kurangi stok otomatis”** (biar stok ikut berkurang sesuai jenisnya).
   4. **“Izinkan stok minus”** → centang (untuk data dokumen lama).
   5. **“Buat barang baru otomatis”** → biarkan **kosong** dulu; lebih baik nama
      barang dicek dulu supaya tidak ada barang dobel.
4. Klik **`Tes koneksi`** → harus muncul pesan hijau:
   *“File terbaca. 122 sheet berisi data. Sheet terbaru: 14 OKT (150 baris)”* ✅
5. Klik **`Simpan`**.
6. Klik **`Pratinjau`** → muncul ringkasan: berapa baris baru, berapa unit, contoh
   barang. **Cek angkanya dulu** (mis. KURSI TRAINING 23, bukan 45).
7. Kalau sudah benar → klik **`Sinkron sekarang`**.
   Hasilnya muncul notifikasi: *“Sinkron selesai — sheet 14 OKT: … permintaan, … unit”*.

---

## LANGKAH 4 — Aktifkan mode otomatis tiap 15 menit — ±4 menit

Ini yang bikin tim tidak perlu klik apa-apa lagi.

1. Balik ke **Supabase Dashboard → SQL Editor → New query**.
2. Buka file **`docs/sql/setup_cron.sql`** → copas seluruh isinya.
3. **Ganti 2 tulisan placeholder** sebelum di-Run:

| Tulisan di file | Diganti dengan | Di mana melihatnya |
|---|---|---|
| `<PROJECT-REF>` | Reference ID project kamu, mis. `abcdefghijklmnop` | Project Settings → General → **Reference ID** |
| `<SERVICE-ROLE-KEY>` | kunci rahasia `service_role` | Project Settings → **API Keys** → `service_role` → klik **Reveal/Copy** |

   ⚠️ **Kunci `service_role` itu RAHASIA** (setara password admin). Jangan kirim ke
   siapa pun, jangan taruh di WhatsApp/grup. Ini hanya ditempel di SQL Editor
   punyamu sendiri lalu disimpan di database kamu sendiri.
4. Klik **`Run`** → muncul **“Success”**.
5. Cek jadwal aktif: di hasil Run ada tabel `cron.job` — pastikan ada baris
   `sync-google-sheet-pengiriman` dengan `active = true`.
6. Verifikasi otomatis jalan: tunggu 15–30 menit, lalu di aplikasi buka panel
   **Sinkron Google Sheet** → bagian “5 eksekusi terakhir” akan terisi sendiri. ✅

> **Mau berhenti otomatis?** Jalankan baris ini di SQL Editor:
> `SELECT cron.unschedule('sync-google-sheet-pengiriman');`
> Aplikasi tetap bisa dipakai manual lewat tombol **Sinkron sekarang**.

---

## LANGKAH 5 — Merge perbaikan qty ke aplikasi (WAJIB) — ±1 menit

Supaya perbaikan qty (23 → tidak lagi 45) dan semua fitur baru aktif di aplikasi
yang dipakai tim:

1. Buka **https://github.com/saintanggi/assetflow/pull/4**
2. Klik tombol **`Merge pull request`** → **`Confirm merge`**.
3. Tunggu ±2 menit — Vercel otomatis deploy ulang. Selesai.

> Kalau kamu mau, bilang **“merge”** dan saya yang klik-nya dari sini.

---

## CARA PAKAI SEHARI-HARI (untuk tim)

1. Buka Google Sheet **DOKUMEN PENGIRIMAN 2026**.
2. Buat **sheet baru** dengan nama tanggal, contoh: **`15 OKT`** (format: angka + bulan
   singkat 3 huruf, huruf besar). Isi kolom persis seperti sheet sebelumnya
   (header: `In Progress Date`, `NO TICKET`, `CABANG/GERAI`, … `STATUS ASSET`,
   `STATUS TERKIRIM`).
3. Isi datanya. **Aturan QTY**: tulis jumlah unit sekali di baris pertama tiap blok
   barang (biasanya sel di-merge untuk beberapa baris/resi) — sistem akan membagi
   ke baris-barisnya. Kalau satu baris = satu unit dan punya `BARCODE` sendiri,
   kolom QTY boleh dibiarkan kosong.
4. Simpan. Sistem akan mengambilnya otomatis (maksimal 15 menit). Tidak perlu
   klik apa pun.
5. **Jangan** menaruh tab sisa seperti `Copy of …` untuk tanggal terbaru; sistem
   mengabaikan `Copy of`, tapi lebih rapi kalau dihapus.

**Yang perlu diisi supaya lancar:**
- `NO TICKET` → kalau kosong, sistem membuat nomor otomatis `UPL-<tanggal>-n`.
- `In Progress Date` → kalau kosong, dipakai tanggal hari ini.
- `NAMA BARANG` → harus sama dengan **Master Barang** (kalau belum ada, baris itu
  dilewati dan dilaporkan; bisa dibikin otomatis lewat centang “Buat barang baru otomatis”).

---

## KALAU ADA MASALAH (troubleshooting singkat)

| Yang muncul | Artinya | Yang dilakukan |
|---|---|---|
| *“File Google Sheet tidak bisa diunduh”* | Sharing file belum “Siapa saja yang memiliki link” | Bagikan → **Siapa saja yang memiliki link** → **Pelihat** → Done |
| *“Fungsi sync-sheets belum di-deploy”* | Langkah 2 belum selesai | Ulangi Langkah 2 (Cara A) |
| *“Hanya Super Admin (settings.manage)…”* | Login-nya bukan super admin | Login pakai akun super admin |
| *“N nama barang belum ada di master …”* | Nama barang beda/tidak ada | Tambah di **Master Barang**, atau centang “Buat barang baru otomatis” lalu Sinkron lagi |
| *“Lokasi STOK-BARU belum ada”* | Migrasi lokasi lama belum dijalankan | Kirim screenshot ke saya |
| Qty terlihat tidak sesuai | File-nya memang begitu | Buka **Pratinjau** — kolom **Catatan** menjelaskan asalnya (“QTY file 23 untuk 23 baris”, “QTY kosong → dihitung 6 dari 6 baris”) |
| Jadwal tidak jalan | `pg_cron`/`pg_net` belum aktif atau placeholder belum diganti | Cek hasil run: `SELECT * FROM cron.job;` — `active` harus `true` |

**Cara melihat riwayat sinkron otomatis** (tempel di SQL Editor):

```sql
SELECT started_at, sheet_name, status, requests_created, qty_imported, message
FROM public.sheet_sync_runs
ORDER BY started_at DESC
LIMIT 20;
```

---

## CHECKLIST CEPAT

- [ ] **Langkah 1** — `docs/sql/setup_sheet_sync.sql` dijalankan → “Success” ✅
- [ ] **Langkah 2** — Edge Function `sync-sheets` berstatus **Deployed** ✅
- [ ] **Langkah 3** — Panel: Tes koneksi hijau → Simpan → Pratinjau → Sinkron sekarang ✅
- [ ] **Langkah 4** — `docs/sql/setup_cron.sql` (placeholder sudah diganti) → jadwal aktif ✅
- [ ] **Langkah 5** — PR #4 di-**Merge** ✅

Kalau sudah semua: tim isi sheet tanggal baru → data masuk sendiri. 🎉
