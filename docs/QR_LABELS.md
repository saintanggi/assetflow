# Mesin cetak QR — kertas 100 × 150 mm, label 20 × 15 mm

## Aktivasi

1. Terapkan migrasi sebelumnya, kemudian **sekali** jalankan
   `supabase/migrations/20261019000038_serial_qr_labels.sql` di database Supabase
   yang digunakan aplikasi (SQL Editor atau alur migrasi proyek).
2. Deploy frontend hasil `npm run build`.
3. Semua lokasi/perangkat harus menggunakan **proyek Supabase yang sama**.
   Database dev dan production memiliki penghitung berbeda, bukan nomor global lintas proyek.
4. Pengguna membutuhkan izin `labels.print` (Super Admin sudah memiliki izin).
   Hak akses lama tidak diperluas otomatis untuk role operasional.

Migrasi tidak mengganti SKU, kode aset, barcode lama, stok, atau data permintaan.
Penghitung awal mengikuti nomor numerik tertinggi (1–12 digit) yang ditemukan pada
`assets.asset_code`, `inventory_items.sku`, `inventory_items.barcode`, dan
`request_items.barcode` (termasuk multi-baris). Jika tidak ada, label pertama adalah
`000000000001`. Barcode lama alfanumerik atau lebih dari 12 digit tidak menjadi
patokan penghitung. Hentikan sementara impor/penerbitan barcode lama saat aktivasi;
setelah itu gunakan mesin ini untuk semua nomor baru. Nomor dari sistem lain atau
nomor yang diketik manual di field lama tidak otomatis dipesan pada ledger baru.

## Penggunaan

Buka **Cetak Label → QR Berurutan · Kertas 100 × 150 mm**.

- **Barang/SKU:** pilih barang dan jumlah unit (1–500). Setiap unit mendapatkan nomor
  unik. Contoh: A memesan 3 nomor → 001–003, B berikutnya → 004 dst. Angka ditampilkan
  12 digit dengan nol di depan. Setiap label tetap terhubung ke SKU; ini tidak membuat
  baris aset fisik baru dan tidak mengubah jumlah stok.
- **Aset terdaftar:** satu aset fisik mendapat satu nomor. Permintaan ulang, bahkan
  dari pengguna berbeda, mengembalikan nomor yang sama.
- Klik **Simpan & buat nomor**, periksa pratinjau, lalu **Cetak**. QR berisi tepat nomor
  12 digit yang tertulis di bawahnya, bukan URL panjang agar terbaca pada label kecil.
- **Cetak ulang:** buka batch dari riwayat bersama, atau cari 12 digit nomor. Pilih
  label yang perlu diganti saja. Tidak ada nomor baru yang diterbitkan.
- Scanner aplikasi memetakan nomor ke detail aset/barang sesuai izin `assets.view`
  atau `inventory.view`. Pemindai kamera umum hanya menampilkan angka nomor, bukan
  membuka halaman publik secara otomatis.
- Label lama 90 × 60 mm masih tersedia di tab terpisah dan tidak memakai ledger ini.

## Template lembar 100 × 150 mm

Template mengikuti struktur foto: **bingkai hitam, nama di atas, QR di tengah,
nomor di bawah**. Nama default **SiCepat** berupa teks tebal (bukan file logo),
bisa diganti lewat **Tulisan atas label** (maksimal 24 karakter; nama terlalu
panjang ditampilkan dengan elipsis). Pengaturan nama dan susunan disimpan pada
browser ini; pengaturan tersebut tidak memengaruhi nomor/database.

**Ukuran tiap stiker tetap 20 × 15 mm**, termasuk bingkai dan padding, sesuai
permintaan awal. Ukuran dan jarak fisik stiker dalam foto tidak dapat ditentukan
akurat tanpa pengukuran; contoh hanya menjadi acuan gaya dan jumlah kolom/baris.

| Susunan | Kapasitas | Margin kiri/kanan | Margin atas/bawah | Jarak kolom | Jarak baris |
| --- | --- | --- | --- | --- | --- |
| 4 kolom × 6 baris (default, seperti contoh) | 24 label | 4 mm | 10 mm | 4 mm | 8 mm |
| 4 kolom × 8 baris (rapat) | 32 label | 4 mm | 4,5 mm | 4 mm | 3 mm |

Kedua susunan tepat muat pada kertas **100 mm lebar × 150 mm tinggi**, tanpa
mengubah ukuran label. Margin/jarak sudah termasuk dalam template, bukan margin
tambahan pada pengaturan dialog print. Susunan 4 × 6 sengaja memberi jarak vertikal
lebih lebar agar tetap 24 label sambil mempertahankan tinggi label 15 mm.

- Urutan nomor **kiri ke kanan → baris selanjutnya → lembar berikutnya**.
- Lebih dari 24/32 label otomatis dibagi ke lembar berikutnya.
- Lembar terakhir boleh tidak penuh; slot sisanya kosong, tidak mengulang nomor.
- Pratinjau memakai komponen dan ukuran yang sama dengan dokumen cetak.
- Pilihan nomor untuk cetak ulang dirapatkan dari kiri atas, bukan mempertahankan
  posisi stiker lama. Gunakan **lembar baru**; belum mendukung mulai dari slot
  tertentu pada lembar bekas/terpakai sebagian.
- Mengganti tulisan atau susunan hanya mengubah tampilan, tidak memesan nomor lagi.

## Setelan printer

- Pilih media **100 × 150 mm**, orientasi **portrait**, satu lembar template per
  halaman (jangan pilih kertas 20 × 15 mm di driver).
- Skala **100% / Actual size**, bukan “Fit to page”. Margin printer 0;
  header/footer nonaktif, satu halaman per lembar, jangan aktifkan N-up/multiple pages.
- Dokumen cetak dibuat dalam iframe terpisah dengan `@page size: 100mm 150mm`, QR SVG
  hitam putih dan quiet zone. Layout sidebar/kartu aplikasi tidak ikut dicetak.
- Uji satu lembar dan pindai hasil fisik. Resolusi printer, kalibrasi media, ukuran
  kertas yang dipaksakan driver, dan skala browser tetap dapat memengaruhi hasil.
  Gunakan resolusi cetak yang memadai untuk label kecil (300 dpi jika tersedia).
- Template cocok untuk **lembar stiker polos 100 × 150 mm** yang dipotong mengikuti
  bingkai. Jika memakai stiker **pre-cut**, ukur posisi potongan dan jaraknya dahulu;
  ukuran kertas saja tidak menjamin grid sesuai potongan fisik.

## Jaminan dan batasan

- Satu baris penghitung dikunci `SELECT … FOR UPDATE` di PostgreSQL selama transaksi.
  Nomor, batch dan kemajuan penghitung disimpan atomik. Setiap batch mendapat satu
  rentang berurutan; PK/unique constraint menolak duplikasi nomor pada ledger.
- UUID permintaan menjaga retry idempoten. Browser menyimpan permintaan tertunda di
  `sessionStorage` per akun **sebelum** memanggil RPC. Bila respons hilang, gunakan
  **Coba lagi**; memuat ulang tab yang sama tetap memakai UUID yang sama. Jangan
  menghapus storage/menutup tab lalu menerbitkan batch baru untuk unit yang sama
  sebelum memeriksa riwayat, karena tab baru tidak memiliki kunci permintaan lama.
- Nomor tidak dikembalikan ke pool ketika dialog cetak dibatalkan/printer gagal.
  Lanjutkan melalui riwayat. Riwayat adalah **penerbitan nomor**, bukan bukti kertas
  berhasil dicetak; browser tidak dapat memastikan kertas keluar dari printer.
- Cetak ulang memang bisa menghasilkan stiker fisik dengan nomor yang sama.
  Lepas/musnahkan label lama dan jangan tempel nomor yang sama pada dua barang.
  Sistem menjamin nomor **baru** unik, bukan mencegah fotokopi atau duplikasi fisik.
- Jangan reset penghitung, menghapus ledger, atau menerbitkan nomor di luar RPC.
  Akun aplikasi tidak mendapat izin insert/update/delete langsung pada tabel ini.
  Tidak ada fallback penomoran offline/localStorage.
- Counter dibatasi 12 digit dan menolak overflow (bukan memotong nomor).

## Pengujian

```bash
npm ci
npm test -- --maxWorkers=2 --minWorkers=1
npm run build
```

Tes PGlite menjalankan SQL migrasi dan fungsi PostgreSQL sungguhan pada schema
fixture: retry, lintas pengguna, aset tetap, validasi, rollback, unik, RLS/izin,
resolusi scanner, nomor lama, dan overflow. PGlite menserialisasi satu koneksi;
ini **bukan** simulasi contention multi-koneksi production. Sebelum go-live,
uji dua sesi pengguna di PostgreSQL staging memesan label bersamaan, pastikan
rentang berbeda dan retry UUID lama mengembalikan rentang semula. Lakukan juga
uji printer fisik karena pengujian otomatis tidak menguji perangkat keras.
