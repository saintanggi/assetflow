# Panduan Rekonsiliasi Dokumen Pengiriman 12–15 Okt 2026

Empat file CSV (`DOKUMEN PENGIRIMAN 2026 - 12/13/14/15 OKT.csv`) sudah dicocokkan
memakai **parser resmi sistem** (`src/lib/shippingUpload.ts`) — persis logika yang
dipakai menu *Upload Dokumen Pengiriman* dan sinkron Google Sheet. Hasilnya:
data di sistem untuk tiket-tiket ini akan dibuat **sama persis dengan CSV**,
tanpa perlu mencari tiket satu per satu.

---

## 1. Angka yang benar menurut CSV

| | |
|---|---|
| Baris data di 4 CSV | 397 |
| Permintaan (tiket + tanggal + gerai) | 52 |
| Tiket unik | 51 tiket HO + 1 label buatan (lihat catatan KURSI di bawah) |
| Baris barang (tiket × barang × kondisi) | 122 |
| **Total qty terkirim** | **402 unit** — 82 dari stok ASSET BARU, 320 dari ASSET RETUR |
| Status | semuanya TERKIRIM (tidak ada PENDING di 4 file ini) |

Perincian lengkap per tiket ada di **`HASIL-COCOKAN-12-15-OKT-2026.xlsx`**:

- sheet **DAFTAR_TIKET** — 1 baris per tiket (paling cepat untuk cek manual),
- sheet **PER_TIKET_BARANG** — qty benar per tiket + barang + kondisi, lengkap
  dengan daftar barcode, resi, dan SN,
- sheet **DETAIL_BARIS_CSV** — 397 baris CSV apa adanya,
- sheet **PERINGATAN** — anomali di file sumber (ringkasannya di bawah).

### Temuan penting di file sumber

1. **KURSI TRAINING 23 unit, bukan 45.** Blok di file 14 OKT baris 119–141
   (Semarang Sortation (HLDP Batch 2)) kolom QTY-nya di-merge = 23 untuk 23 baris.
   Parser lama menghitungnya 23 + 22 baris lanjutan = 45 — hampir pasti inilah
   salah satu angka membengkak di sistem. Blok ini juga **tidak punya no tiket
   dan tanggal**; di file upload-ulang diberi label tiket `HLDP-BATCH2-14102026`
   dan tanggal 14-Oct-26 supaya bisa dicari dan tidak dobel.
2. **⚠️ Barcode + SN sama di 2 tiket — perlu cek fisik.** KEYBOARD barcode
   `A1300013139` / SN `2130MR120A18` tertulis di tiket **A2610140946**
   (Bogor Depok Sortation) *dan* **A2610140947** (Jakarta Kalideres
   Sortation). Satu fisik keyboard tidak mungkin terkirim ke dua gerai;
   kemungkinan salah copy di sheet. Sistem akan mencatat keduanya terkirim
   (stok terpotong 2×) sampai sheet-nya diperbaiki — tentukan gerai yang benar
   lalu koreksi baris yang salah.
3. **Tanggal untuk 2 blok yang kolom tanggalnya kosong di sheet:**
   tiket **A2609302102** (Batam Sortation, 24 baris) + **A2610080552** di file
   13 OKT → diisi `12-Oct-26` (keputusan 19 Okt 2026, berdasarkan hasil cek:
   di sistem lama tersimpan 2026-10-11 = tanggal sumber 12 Okt yang kena bug
   mundur 1 hari); blok KURSI di file 14 OKT → diisi `14-Oct-26`.
   Kalau tanggal kirim sebenarnya berbeda, ubah dulu di file dalam folder
   `file-upload-ulang/` sebelum di-upload.
4. Tiket **A2610130881** muncul di 2 file (7 jenis barang di 13 OKT +
   SCANNER WIRELESS 3 unit di 14 OKT, tanggal sama) — total benar **24 unit**.
   Wajar tampil sebagai 2 permintaan bernomor tiket sama.
5. Isi file tidak murni satu tanggal (file 13 OKT berisi tanggal 11/12/13,
   dst). Sistem mengikuti kolom *In Progress Date* per baris — sudah benar.
6. 3 baris MicroSD kolom BARCODE-nya berisi teks `SUDAH` (bukan barcode
   fisik). QTY tetap benar, hanya tidak terlacak per unit.

---

## 2. Kenapa perbaikannya begini (hapus bersih → upload ulang)?

- Upload ulang file yang sama **tidak memperbaiki** data lama: sistem punya
  filter anti-duplikat (tiket + barang + barcode/resi) sehingga baris yang
  sudah pernah masuk akan **dilewati**, termasuk yang qty-nya salah.
- File Asli Google Sheet juga tidak aman di-upload sebagai CSV: baris yang
  tanggalnya kosong akan kena **tanggal hari upload**. Karena itu disediakan
  folder `file-upload-ulang/` — isinya identik, hanya tanggal kosong sudah
  diisi dan blok KURSI diberi label tiket. (Sudah diverifikasi: hasil parse
  kedua versi file sama persis.)
- Menghapus permintaan lewat mekanisme Super Admin yang sudah ada
  (migrasi `20261016000035`) otomatis menghapus transaksi kirim `REQ-KIRIM/…`
  terkait **dan memulihkan saldo stok**, jadi tidak ada stok yatim/minus palsu.
- Tiket yang *sudah cocok* pun ikut dihapus-lalu-dibuat-ulang (hasil akhirnya
  sama persis; yang berubah hanya nomor `REQ-…` internal, no tiket HO tetap).
  Cara ini yang paling aman supaya tidak ada sisa baris nyangkut.

---

## 3. Langkah perbaikan (kerjakan dalam satu sesi, urut)

### Langkah 1 — Lihat selisihnya dulu (read-only)

1. Buka <https://supabase.com/dashboard> → project AssetFlow → **SQL Editor**
   → **New query**.
2. Copas **seluruh** isi `docs/sql/rekonsiliasi_cek_pengiriman_12-15okt2026.sql`
   → **RUN**.
3. Hasilnya satu tabel; baca kolom `bagian`:
   - `2_SELISIH` — daftar tiket/barang yang tidak cocok (qty beda, belum ada, dll),
   - `7_AKAN_DIHAPUS_OLEH_PERBAIKI` — **daftar persis** yang akan dihapus pada
     Langkah 2. Periksa daftar ini baik-baik.
   - `4_TIKET_DB_TIDAK_DI_CSV` — permintaan 11–15 Okt yang tiketnya tidak ada di
     CSV. Ini **tidak** ikut dihapus (mungkin input manual/sheet lain) — cukup
     diketahui. *(Kecuali blok KURSI lama di `5_BLOK_KURSI_LAMA`.)*

### Langkah 2 — Hapus bersih inputan tiket-tiket CSV

> Prasyarat: trigger hapus-aman sudah terpasang
> (`docs/sql/admin_delete_request_and_transaction.sql`, migrasi 000035).
> Script perbaiki berhenti sendiri dengan pesan jelas bila belum ada.

1. Copas **seluruh** isi
   `docs/sql/rekonsiliasi_perbaiki_pengiriman_12-15okt2026.sql` → **RUN**.
   Muncul pesan `MODE CEK: N permintaan AKAN dihapus` — **belum ada yang
   terhapus**. Samakan angka N dengan jumlah baris bagian 7 di Langkah 1.
2. Ubah baris `v_yakin boolean := false;` menjadi `true`, lalu **RUN lagi
   seluruh file**. Hasil akhir menampilkan `sisa_target_seharusnya_0 = 0`.

> ⚠️ Setelah langkah ini, saldo stok BARU/RETUR tampak **naik sementara**
> (402 unit "kembali" ke gudang di atas kertas). Itu normal — lanjutkan
> langsung ke Langkah 3 di sesi yang sama; jangan ada transaksi gudang lain
> di antaranya sebisa mungkin.

### Langkah 3 — Upload ulang dari file yang sudah dibersihkan

1. Di aplikasi: menu **Permintaan → Upload Dokumen Pengiriman**.
2. Upload file dari folder **`rekonsiliasi/file-upload-ulang/`** (jangan file
   Asli Google Sheet), satu per satu dengan urutan **12 → 13 → 14 → 15 OKT**.
3. Pastikan opsi **"Kurangi stok otomatis" AKTIF** (supaya stok terpotong ulang).
4. Sebelum klik Import, samakan angka pratinjau dengan tabel ini:

   | File | Permintaan | Baris barang | Total QTY |
   |---|---|---|---|
   | 12 OKT | 9 | 16 | 35 |
   | 13 OKT | 9 | 20 | 120 |
   | 14 OKT | 19 | 47 | 142 |
   | 15 OKT | 16 | 39 | 105 |

   Kalau angkanya beda, **berhenti** — jangan import dulu, cek penyebabnya
   (biasanya salah pilih file/sheet).

### Langkah 4 — Verifikasi akhir

Jalankan lagi `docs/sql/rekonsiliasi_cek_pengiriman_12-15okt2026.sql`.
Target akhir: bagian `2_SELISIH` **kosong** dan ringkasan menunjukkan
122 baris **COCOK**. Bila masih ada selisih:

- `BELUM_ADA_DI_SISTEM` untuk 1–2 barang → kemungkinan nama barang beda ejaan
  dengan master sehingga terbuat barang baru (cek bagian
  `6_BARANG_BELUM_DI_MASTER` dari run pertama). Samakan ejaan di master, atau
  perbaiki nama di file upload-ulang lalu ulangi Langkah 2–4 (script aman
  diulang; daftar tiketnya sama).
- Selisih hanya di tiket A2609302102/A2610080552 → soal tanggal asumsi
  (catatan no. 3 di atas).

### Catatan sinkron Google Sheet

Kalau sinkron otomatis aktif (cron 15 menit), tidak perlu dimatikan: ia hanya
membaca sheet terbaru dan anti-duplikat, jadi tidak akan menggandakan hasil
upload ulang. Hanya saja sheet 12–14 tidak akan terimpor otomatis — Langkah 3
tetap wajib manual.

---

## 4. Isi paket rekonsiliasi ini

```
rekonsiliasi/
├── PANDUAN-REKONSILIASI.md              ← file ini
├── HASIL-COCOKAN-12-15-OKT-2026.xlsx    ← hasil cocokan final per tiket
├── expected-lines.csv                   ← versi CSV dari data "yang benar"
├── sumber/                              ← 4 CSV ASLI persis seperti dikirim (arsip)
└── file-upload-ulang/                   ← 4 CSV untuk di-upload ulang (tanggal diisi)
docs/sql/
├── rekonsiliasi_cek_pengiriman_12-15okt2026.sql        ← Langkah 1 & 4 (read-only)
└── rekonsiliasi_perbaiki_pengiriman_12-15okt2026.sql   ← Langkah 2 (hapus bersih)
```

Kedua script SQL sudah diuji jalan di database Postgres lokal dengan contoh
data berantakan (qty membengkak 19 vs 10, KURSI 45, tanggal bergeser, tiket
asing) — kategorinya terdeteksi benar dan penghapusan hanya menyentuh tiket
CSV + blok KURSI lama, tidak menyentuh permintaan lain.
