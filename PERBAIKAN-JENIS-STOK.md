# 🔧 PERBAIKAN JENIS STOK — ASSET BARU vs ASSET RETURN

> Kasus: gerai (contoh **SiCepat Ekspres Purbalingga Kartanegara**) mengajukan
> permintaan dengan **RETURN / ASSET RETUR**, tetapi di **Log Transaksi** terbaca
> **BARU** dan stok yang terpotong **Stok Barang Baru** — bukan Stok Barang Retur.

## Akar masalah yang ditemukan (audit 16 Okt 2026)

| # | Lokasi | Masalah | Perbaikan |
|---|---|---|---|
| 1 | RPC `sync_ship_request_items` (jalur **Sinkron Google Sheet**) | Masih versi lama: SEMUA item dipotong dari **satu lokasi** `p_location_id`, mengabaikan STATUS ASSET item. Versi `ship_request_items` sudah pernah dibenahi (multi-lokasi), tetapi versi sinkronnya **tidak ikut** | Migration `20261016000034_sync_ship_multilocation.sql` — disamakan persis dengan versi multi-lokasi: **ASSET BARU → STOK-BARU · ASSET RETUR/RETURN → STOK-RETUR · UNREADY → STOK-UNREADY** |
| 2 | Edge Function + Upload Dokumen | `status_aset` disimpan **teks mentah** file (mis. `"RETURN"`, `"ASSET RETURN"`) ke `request_items` — label tidak konsisten dan koreksi jenis stok tidak pernah dianggap "sudah benar" | Normalisasi ke kanonis (`ASSET BARU / ASSET RETUR / UNREADY`) lewat `kanonisAsetOf()` sebelum disimpan |
| 3 | Script koreksi lama `koreksi_lokasi_potong.sql` | **Pasti gagal** di SQL Editor: memanggil RPC ber-permission (`has_permission`) padahal SQL Editor berjalan tanpa login JWT — semua koreksi ditolak "Izin ditolak" | Script baru `docs/sql/perbaiki_jenis_stok_semua.sql` — SQL langsung, tanpa RPC ber-permission |
| 4 | Halaman Log Transaksi | Tidak menampilkan Status Aset barang, jadi ketidaksesuaian tidak terlihat | Kolom baru **"Status Aset"** + tanda ⚠ bila tidak cocok dengan lokasi stok + ikut diekspor ke CSV |

Semua sudah diuji otomatis di Postgres lokal: permintaan campuran (BARU + RETUR
dalam satu pengiriman) kini membuat **satu transaksi OUT per lokasi** dan tiap
jenis stok terpotong dari lokasinya masing-masing.

## Yang perlu Anda lakukan (sekali saja, berurutan)

### Langkah 1 — Perbarui fungsi database (BLOK A)
Supabase → **SQL Editor** → New query → copas **seluruh isi BLOK A** dari
`COPAS-KE-SUPABASE.md` → **Run**.
Harus muncul `Success. No rows returned`. (Aman diulang.)

> BLOK A sekarang berisi `sync_ship_request_items` versi multi-lokasi.
> Alternatif: jalankan saja file `supabase/migrations/20261016000034_sync_ship_multilocation.sql`.

### Langkah 2 — Perbarui Edge Function (BLOK B)
Supabase → **Edge Functions** → `sync-sheets` → **Edit** → hapus semua →
paste **BLOK B** terbaru dari `COPAS-KE-SUPABASE.md` → **Deploy**.

### Langkah 3 — Benahi data lama yang salah (sekali jalan)
Supabase → **SQL Editor** → New query → copas seluruh isi
**`docs/sql/perbaiki_jenis_stok_semua.sql`** → **Run**.

Yang dilakukan script ini:
1. merapikan label `status_aset` di data permintaan (`RETURN` → `ASSET RETUR`, dst.),
2. mengisi status aset yang kosong pada item transaksi **dari permintaannya**
   (lewat referensi `REQ-KIRIM/…`),
3. mendeteksi semua transaksi masuk/keluar yang lokasi stoknya tidak cocok
   dengan jenis asetnya,
4. membuat transaksi **transfer penyeimbang** per selisih (stok kembali sesuai),
5. mencetak ringkasan `NOTICE` + daftar sisa yang perlu perhatian.

Aman dijalankan berulang — yang sudah benar tidak disentuh lagi.

### Langkah 4 — Verifikasi
Jalankan di SQL Editor (sesuaikan nama gerai bila perlu):

```sql
SELECT t.transaction_date, t.doc_number, r.ticket_no, r.branch_name AS gerai,
       i.sku, i.name AS barang, ti.qty, ti.status_aset,
       l.code AS lokasi_terpotong
FROM inventory_transaction_items ti
JOIN inventory_transactions t ON t.id = ti.transaction_id
JOIN inventory_items i        ON i.id = ti.item_id
LEFT JOIN locations l         ON l.id = t.source_location_id
LEFT JOIN requests r          ON r.request_number = replace(t.reference, 'REQ-KIRIM/', '')
WHERE t.type = 'out' AND t.status = 'posted'
  AND r.branch_name ILIKE '%Purbalingga%'
ORDER BY t.transaction_date DESC, t.doc_number;
```

Hasil yang benar: baris ber-`status_aset = ASSET RETUR` ber-`lokasi_terpotong = STOK-RETUR`,
baris `ASSET BARU` ber-`STOK-BARU`. Di aplikasi, halaman **Log Transaksi** kini
juga punya kolom **Status Aset**.

## Aturan jenis stok (acuan)

| STATUS ASET di dokumen | Lokasi stok | Label kanonis |
|---|---|---|
| ASSET BARU / BARU / NEW / kosong | `STOK-BARU` (Stok Barang Baru) | `ASSET BARU` |
| ASSET RETUR / RETUR / RETURN | `STOK-RETUR` (Stok Barang Retur) | `ASSET RETUR` |
| UNREADY | `STOK-UNREADY` | `UNREADY` |
