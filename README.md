# AssetFlow — Sistem Permintaan, Persediaan & Aset

Aplikasi web internal untuk mengelola **permintaan barang dari kantor/gerai ke gudang**,
**stok persediaan per kondisi**, dan **aset tetap** — lengkap dengan pencatatan transaksi
yang bisa diaudit, cetak label QR/barcode, laporan, serta katalog aset publik.

> Dokumen ini menjelaskan **cara kerja sistem** untuk tim operasional.
> Untuk instalasi/deploy teknis, lihat bagian [8. Untuk Developer](#8-untuk-developer).

---

## 1. Tiga hal utama yang dikerjakan sistem ini

| # | Proses | Inti |
|---|---|---|
| 1 | **Permintaan Barang** | Kantor/gerai mengajukan barang → gudang review → helper siapkan → gudang kirim & catat transaksi keluar |
| 2 | **Persediaan** | Stok dicatat per **kondisi barang**: Baru / Retur / Unready, per gudang & lokasi |
| 3 | **Aset Tetap** | Data aset (laptop, printer, kendaraan, …), label QR, dan katalog publik |

---

## 2. Alur Permintaan Barang (alur utama)

```
 ┌──────────────┐   ┌───────────────┐   ┌──────────────┐   ┌──────────────┐
 │  ADMIN HO    │   │ ADMIN GUDANG  │   │    HELPER    │   │ ADMIN GUDANG │
 │ Input tiket  │──▶│ Review &      │──▶│ Siapkan      │──▶│ Kirim barang │
 │ (diajukan)   │   │ setujui qty   │   │ barang +     │   │ + catat OUT  │
 │              │   │               │   │ barcode/SN   │   │              │
 └──────────────┘   └───────────────┘   └──────────────┘   └──────────────┘
                          │                                       │
                          ├── Ditolak (alasan wajib)              ▼
                          └── Disetujui sebagian ──▶ Sisa Belum Terkirim
                                                     (kirim susulan saat stok datang)
```

### Status permintaan

| Status | Arti | Siapa yang mengubah |
|---|---|---|
| **Diajukan** | Permintaan baru masuk, menunggu review gudang | Admin HO (input) |
| **Disetujui** | Semua qty disetujui | Admin Gudang |
| **Disetujui Sebagian** | Sebagian disetujui, sisanya masuk **Sisa Belum Terkirim** | Admin Gudang |
| **Diproses** | Barang sedang disiapkan helper (barcode/SN diisi) | Helper |
| **Selesai** | Semua item terkirim atau ditolak | Admin Gudang |
| **Ditolak** | Permintaan ditolak, alasan wajib diisi | Admin Gudang |

### Cara input permintaan (3 jalur)

1. **Manual** — menu **Permintaan → Buat Permintaan**. Isi No Tiket, Cabang/Gerai, lalu pilih barang.
   Saat memilih barang, sistem langsung menampilkan **sisa stok Baru / Retur / Unready**.
2. **Upload dokumen pengiriman** — menu **Permintaan → Upload Dokumen** (file Excel).
3. **Sinkron otomatis Google Sheet** — sheet tanggal terbaru dibaca otomatis tiap 15 menit
   (lihat [bagian 6](#6-sinkron-google-sheet--upload-dokumen)).

### Saat mengirim barang

- Admin Gudang mengisi **qty kirim**, **no resi**, dan **lokasi gudang pengirim**.
- Lokasi stok yang dipotong **ditentukan oleh Status Asset tiap baris** (lihat bagian 3).
- Pengiriman otomatis membuat **transaksi OUT** (stok berkurang + tercatat di buku besar).
- Barang yang sudah dikirim sebagian tetap muncul di **Sisa Belum Terkirim** untuk dikirim susulan.

---

## 3. Stok: 3 kondisi, 3 lokasi

Sistem memisahkan stok berdasarkan kondisi barang. Kode lokasi baku:

| Status Asset | Lokasi stok | Arti |
|---|---|---|
| **ASSET BARU** | `STOK-BARU` | Barang baru, siap pakai |
| **ASSET RETUR** | `STOK-RETUR` | Barang retur / selesai servis |
| **UNREADY** | `STOK-UNREADY` | Barang rusak / belum siap pakai |

⚠️ **Penting dipahami tim:**

- Menu **Persediaan** menampilkan stok **TOTAL semua lokasi**.
- Saat **pengiriman**, stok dipotong dari **satu lokasi saja** sesuai Status Asset baris tersebut.
- Jadi bisa terjadi stok total "ada 22" tetapi pengiriman gagal karena saldo di lokasi pemotongnya kosong/minus.
  Panel **Kirim** sudah menampilkan saldo per lokasi dan menandai baris yang kurang.
- Mengubah **Nama Barang** pada tiket yang **sudah terkirim** akan **memindahkan stok** ke barang/lokasi
  yang baru secara otomatis (tercatat sebagai transaksi koreksi di Log Transaksi).

---

## 4. Menu & fungsi

| Menu | Fungsi |
|---|---|
| **Dashboard** | Ringkasan stok, permintaan, dan aktivitas terbaru |
| **Aset Tetap** | CRUD aset, detail aset, cetak label QR |
| **Persediaan → Asset Baru / Return / Unready** | Daftar stok per kondisi (masing-masing lokasi) |
| **Persediaan → Master Barang** | Semua barang + total stok, stok awal, detail per barang |
| **Persediaan → Peringatan Stok** | Barang yang habis / di bawah stok minimum |
| **Permintaan** | Daftar permintaan, buat permintaan, detail (review, proses, kirim) |
| **Sisa Belum Terkirim** | Barang disetujui sebagian yang menunggu dikirim susulan |
| **Upload Dokumen** | Import dokumen pengiriman dari Excel + panel sinkron Google Sheet |
| **Transaksi → Barang Masuk** | Penerimaan barang dari supplier/retur |
| **Transaksi → Barang Keluar** | Pengeluaran barang di luar alur permintaan |
| **Transaksi → Transfer Stok** | Pindah stok antar lokasi/gudang |
| **Transaksi → Stock Opname** | Hitung fisik & sesuaikan saldo |
| **Transaksi → Input Kartu Stok** | Catat pergerakan harian (gaya Excel KARTU STOK) |
| **Transaksi → Riwayat / Log Transaksi** | Riwayat transaksi & buku besar per baris IN/OUT (ada koreksi jenis stok) |
| **Pindai Kode** | Scan QR aset / barcode barang (hanya menampilkan informasi) |
| **Cetak Label** | Cetak label QR / barcode |
| **Live Stok** | Posisi stok per gudang: Stok Awal / IN / OUT / Stok Akhir |
| **Laporan** | Rekap & ekspor (CSV/Excel) |
| **Master Data** | Kategori, Gudang & Lokasi, Satuan, Departemen, Pemasok |
| **Pengguna / Peran & Izin** | Kelola akun & hak akses |
| **Audit Log** | Jejak perubahan data |
| **Katalog Publik** (`/publik`) | Halaman publik berisi aset yang dipublikasikan (tanpa harga, serial, stok) |

---

## 5. Peran & hak akses

Sistem memakai **permission** (bukan sekadar role). Role hanya wadah; hak aksesnya diatur per izin.

Role bawaan hanya **Super Admin** dan **Admin**. Peran kerja di lapangan dibentuk dari kombinasi izin berikut:

| Peran kerja | Izin utama | Boleh melakukan |
|---|---|---|
| **Super Admin** | semua izin | Semua modul, kelola pengguna & peran, audit log, pengaturan, publikasi aset |
| **Admin HO** | `requests.create`, `requests.view` | Membuat & upload permintaan barang |
| **Admin Gudang** | `requests.review`, `requests.approve`, `requests.view` | Review, setujui/tolak, memproses, **mengirim** barang, koreksi jenis stok |
| **Helper** | `requests.process` | Menyiapkan barang: isi barcode, serial number, type barang |
| **Operator gudang** | `inventory.*`, `reports.*`, `labels.print` | Transaksi stok, laporan, cetak label |

- Semua izin **dicek di database** (`has_permission()`), bukan hanya disembunyikan di UI.
- `assets.publish` (publikasi aset) hanya bisa diberikan Super Admin.
- Halaman publik hanya menerima data lewat RPC dengan kolom whitelist.

---

## 6. Sinkron Google Sheet & Upload Dokumen

Tim mengisi dokumen pengiriman di Google Sheet (satu sheet per tanggal). Sistem bisa
mengambilnya **otomatis** tanpa upload manual:

- Selalu membaca **sheet tanggal terbaru**; jadwal tiap 15 menit dan **idempoten**
  (dijalankan berulang tidak menggandakan data).
- Aturan qty mengikuti template dokumen (QTY merge = total satu blok).
- Kolom **STATUS ASSET** menentukan stok mana yang dipotong (Baru / Retur / Unready).

Panduan klik-per-klik (non-teknis): **`PANDUAN-SETUP-SINKRON.md`**
Panduan teknis: **`docs/SHEET_SYNC.md`**
Cek apakah sinkron sudah berjalan: **`CEK-SINKRON.md`**

---

## 7. Aturan penting sistem

1. **Stok hanya berubah lewat transaksi yang posted** — setiap perubahan tercatat di
   `inventory_ledger` (buku besar), tidak ada edit saldo langsung dari UI.
2. **Transaksi bersifat atomik** (row lock + idempotency key) — klik ganda tidak menggandakan stok.
3. **Stok bisa minus** pada kondisi tertentu (import/sinkron massal). Stok minus harus
   dibereskan lewat **Stock Opname** atau dipindahkan dari lokasi lain.
4. **Pengiriman memotong satu lokasi** sesuai Status Asset (lihat bagian 3).
5. **Harga, serial number, dan stok tidak pernah tampil di halaman publik.**
6. Setiap perubahan data penting tercatat di **Audit Log**; setiap pergerakan stok
   tercatat di **Log Transaksi**.

---

## 8. Untuk Developer

**Stack:** React 18 + TypeScript + Vite · Tailwind CSS · Supabase (PostgreSQL + Auth + Storage) ·
React Router · TanStack Table · Recharts · Vitest · Vercel.

### Jalankan lokal

```bash
git clone <repo>
cd assetflow
cp .env.example .env      # isi kredensial Supabase
npm install
npm run dev
```

| Variabel | Wajib | Keterangan |
|---|---|---|
| `VITE_SUPABASE_URL` | Ya | URL proyek Supabase |
| `VITE_SUPABASE_ANON_KEY` | Ya | **Anon key** saja (jangan service-role di frontend) |
| `VITE_APP_URL` | Ya | URL publik aplikasi (untuk QR aset) |
| `VITE_APP_NAME` | Tidak | Nama aplikasi (default: AssetFlow) |

### Perintah

```bash
npm run dev       # development server
npm run build     # type-check + build produksi → dist/
npm run preview   # pratinjau hasil build
npm run test      # Vitest
```

### Struktur singkat

```
src/
  pages/         # 1 file = 1 halaman (Permintaan, Persediaan, Transaksi, Aset, …)
  features/
    requests/    # aturan permintaan: stok per lokasi, koreksi barang
    transactions/# form transaksi stok
    barcodes/    # label QR & barcode
  components/    # UI generik (ui/*, DataTable, PageHeader, …)
  context/       # AuthContext (session, profile, permissions)
  lib/           # supabase client, format, permissions, parser upload
  routes/        # definisi route + guard izin
supabase/
  migrations/    # skema, RLS, fungsi RPC (berversi)
  functions/     # Edge Function sync-sheets
  tests/         # tes RLS/RPC
docs/            # DATABASE.md, DEPLOYMENT.md, BOOTSTRAP.md, SHEET_SYNC.md, SQL siap-copas
```

### Database & deploy

- Skema, RLS, dan RPC ada di `supabase/migrations/` — **dijalankan berurutan**.
- Bootstrap Super Admin pertama: `docs/BOOTSTRAP.md`.
- Deploy frontend (Vercel): `docs/DEPLOYMENT.md`.
- Dokumentasi tabel & fungsi: `docs/DATABASE.md`.
- Migrasi baru yang perlu dijalankan manual selalu disertai salinan siap-copas di `docs/sql/`.

> Jangan commit file `.env`. Semua migrasi bersifat idempoten (`IF NOT EXISTS` /
> `CREATE OR REPLACE`) sehingga aman dijalankan ulang.

---

## Dokumen terkait

| Dokumen | Isi |
|---|---|
| `docs/BOOTSTRAP.md` | Membuat Super Admin pertama dari nol |
| `docs/DATABASE.md` | Skema tabel, RLS, dan fungsi RPC |
| `docs/DEPLOYMENT.md` | Deploy Supabase + Vercel, rollback, backup |
| `docs/SHEET_SYNC.md` | Sinkron Google Sheet (teknis) |
| `PANDUAN-SETUP-SINKRON.md` | Sinkron Google Sheet (panduan non-teknis) |
| `docs/sql/` | Query siap-copas: diagnosa, koreksi, setup |
