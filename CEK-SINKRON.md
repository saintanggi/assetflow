# 🔎 CARA CEK: SINKRON SUDAH BENAR-BENAR JALAN ATAU BELUM

> Dari screenshot Anda: **jadwal otomatis sudah aktif** (`cron.job` → `sync-google-sheet-pengiriman`,
> jadwal `*/15 * * * *`, `active = true`). Itu artinya **Langkah 4 selesai** ✅
> Tapi jadwal aktif **belum tentu** datanya sudah masuk — bisa jadi "mesin"-nya belum ada
> atau belum disambungkan. Jalankan 2 cek di bawah untuk memastikan.
>
> **Info terbaru dari file Sheet Anda (saya cek 15 Okt):** sekarang sudah ada sheet **`15 OKT`**
> (102 baris) → jadi sheet terbaru = **`15 OKT`** (bukan `14 OKT` lagi). Patokan angka yang benar
> untuk sheet `15 OKT`: **± 16 permintaan**, **105 unit**, pesan `102/102 baris baru`.

**Cara pakai:** Supabase → **SQL Editor** → **New query** → copas satu blok → **Run**.
(Lihat hasilnya di bagian **Results** bawah.)

---

## CEK 1 — Ringkasan (1x Run, hasilnya 4 baris)

<!-- COPAS MULAI (CEK 1) -->
```sql
SELECT 1 AS urutan, 'Konfigurasi tersimpan (harus ≥ 1)' AS cek, count(*)::text AS hasil
  FROM public.sheet_sync_sources
UNION ALL SELECT 2, 'Riwayat sinkron — jumlah baris', count(*)::text
  FROM public.sheet_sync_runs
UNION ALL SELECT 3, 'Sinkron terakhir — status', coalesce(
  (SELECT status FROM public.sheet_sync_runs ORDER BY started_at DESC LIMIT 1), 'belum pernah')
UNION ALL SELECT 4, 'Panggilan cron terakhir — kode HTTP', coalesce(
  (SELECT status_code::text FROM net._http_response ORDER BY created DESC LIMIT 1), 'belum ada')
ORDER BY 1;
```
<!-- COPAS SELESAI (CEK 1) -->

### Cara membaca hasilnya

| Baris | Hasil | Artinya / yang harus dilakukan |
|---|---|---|
| 1 | angka **≥ 1** | ✅ Langkah 3 sudah tersimpan (aplikasi sudah disambung ke Sheet) |
| 1 | **0** | ❌ Belum: buka aplikasi → **Permintaan → Upload Dokumen Pengiriman** → panel **Sinkron Google Sheet** → paste link Sheet → **Tes koneksi** → **Simpan**. Cron tidak akan mengerjakan apa pun sebelum ini |
| 1 | error *relation … does not exist* | ❌ **Langkah 1 belum dijalankan** → jalankan BLOK A di file `COPAS-KE-SUPABASE.md` |
| 2 | **≥ 1** | ✅ sudah pernah jalan (lihat detail di CEK 2) |
| 2 | **0** | ⏳ belum pernah jalan — tunggu sampai menit `:00 / :15 / :30 / :45`, atau tes sekarang lewat tombol **Sinkron sekarang** di panel aplikasi |
| 3 | **sukses** | 🎉 beres! data sudah masuk |
| 3 | **sebagian** | ⚠️ sebagian masuk, sebagian gagal → lihat kolom `message` di CEK 2, lalu kirim ke saya |
| 3 | **gagal** | ❌ ada error → lihat `message` di CEK 2, screenshot & kirim |
| 3 | **jalan** | ⏳ sedang berproses, tunggu 1 menit lalu cek lagi |
| 4 | **200** | ✅ "mesin"-nya hidup & menjawab |
| 4 | **404** | ❌ nama/URL Edge Function salah → ulangi **Langkah 2** (nama wajib `sync-sheets`) |
| 4 | **401 / 403** | ❌ kunci di BLOK C bukan *service_role* (atau sudah dirotasi) → ulangi BLOK C dengan kunci terbaru |
| 4 | **500** | ❌ error di dalam mesin → kirim screenshot **Edge Functions → sync-sheets → Logs** |
| 4 | **belum ada** | ⏳ jadwal belum pernah terpicu — tunggu ke menit `:15`, atau tes lewat tombol di aplikasi |

---

## CEK 2 — Detail (untuk melihat barang yang masuk & pesan error)

<!-- COPAS MULAI (CEK 2) -->
```sql
SELECT started_at, sheet_name, status, requests_created, qty_imported,
       rows_skipped_dup, message
  FROM public.sheet_sync_runs
 ORDER BY started_at DESC
 LIMIT 20;
```
<!-- COPAS SELESAI (CEK 2) -->

### Cara membaca
- **sheet_name** harus `14 OKT` (sheet terbaru), **bukan** `Copy of 14 OKT` dan bukan `02 JUN`.
- **requests_created** = jumlah permintaan/berita acara yang dibuat.
  Patokan: sheet `15 OKT` → **± 16**; sheet `14 OKT` → **± 21**.
- **qty_imported** = total unit. Patokan: sheet `15 OKT` → **105**; sheet `14 OKT` → **152**.
  (angka jauh lebih besar, mis. > 200, = tanda masih pakai aturan qty lama)
- **rows_skipped_dup** = baris yang dilewati karena sudah pernah masuk → normal (bukti tidak dobel).
- Jalan berikutnya (15 menit lagi) seharusnya menulis `0/150 baris baru, 150 duplikat dilewati` dan **tidak** membuat permintaan baru.

---

## ⚠️ Perbaikan penting tanggal (kalau Langkah 2 sudah Anda kerjakan)

Saya menemukan dan **sudah memperbaiki**: baris yang kolom tanggalnya **kosong** di file dulu memakai
"tanggal hari ini". Akibatnya, kalau sheet yang sama ikut tersinkron lagi **besok**, baris-baris itu
dianggap data baru → **stok terpotong dua kali**.

Sekarang baris tanpa tanggal memakai **tanggal sheet-nya** (sheet `15 OKT` → tanggal `15 Okt 2026`),
jadi aman dijalankan berulang di hari mana pun.

**Yang perlu Anda lakukan:** kalau Langkah 2 (Edge Function) sudah pernah Anda Deploy, **ulangi sekali lagi**:
Supabase → **Edge Functions → `sync-sheets` → Edit** → hapus semua isi → paste ulang **BLOK B** dari
`COPAS-KE-SUPABASE.md` (versi terbaru) → **Deploy**. Kalau belum pernah deploy, cukup pakai yang terbaru
saat mengerjakan Langkah 2.

---

## Kalau mau lihat barangnya langsung di aplikasi
- Menu **Permintaan** → cari catatan dengan keterangan **"Sinkron Google Sheet otomatis (14 OKT)"**.
- Detailnya: **Stok / Kartu Stok** → ada pergerakan `REQ-KIRIM/…` sesuai jenis (ASSET BARU → STOK-BARU,
  RETUR → STOK-RETUR, UNREADY → STOK-UNREADY).
- Barang contoh untuk dicek (dari sheet `14 OKT`, yang sudah diverifikasi vs file asli): **KURSI TRAINING**
  di Batch 2 harus **23**, bukan 45.
- Kalau setelah sinkron jumlah permintaan/stok **bertambah dua kali** untuk sheet yang sama, berarti
  mesin masih versi lama → ulangi Langkah 2 dengan BLOK B terbaru (lihat bagian ⚠️ di atas).

---

## Catatan keamanan (penting, tapi santai)
Screenshot yang Anda kirim **menampilkan kunci rahasia `service_role`**. Sebaiknya setelah semua
berjalan lancar: **Project Settings → API Keys → service_role → Rotate/Revoke**, lalu **ulangi BLOK C
dengan kunci baru**. Aplikasi tidak akan terganggu (aplikasi memakai kunci `anon`), hanya jadwal cron
yang perlu ditempel ulang.
