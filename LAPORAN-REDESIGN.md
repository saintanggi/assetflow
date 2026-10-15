# Laporan Redesign — Tema Premium Enterprise Putih & Merah

Tanggal: 15 Oktober 2026 · Branch: `arena/7821c6bc-assetflow`

---

## 1. Ringkasan perubahan UI/UX

Aplikasi diubah dari tema **gelap (dark command-center, aksen teal)** menjadi **tema terang premium
enterprise** dengan identitas **putih + merah**, tanpa menyentuh logika bisnis, database, API,
autentikasi, role/permission, routing, maupun integrasi Google Sheet.

Yang dikerjakan:

- Design system baru (warna, tipografi, radius, shadow) sebagai satu sumber kebenaran.
- Seluruh komponen dasar (button, card, badge, input, select, textarea, checkbox, dialog, tabel,
  skeleton) ditulis ulang dengan gaya baru.
- Sidebar, topbar, layout utama, dashboard, tabel data, form, dan modal diseragamkan.
- **43 halaman** (termasuk halaman publik dan auth) disesuaikan; tidak ada halaman yang tersisa
  memakai gaya lama.
- Peningkatan aksesibilitas: kontras teks, focus state, label terhubung ke input, aria-label pada
  tombol ikon.

## 2. Halaman & komponen yang diperbarui

**Layout global**
- `src/layouts/AppLayout.tsx` — sidebar putih (252 px, bisa di-collapse ke 76 px), menu aktif
  latar merah muda + teks/ikon merah + indikator kiri, badge antrean, footer pengguna;
  topbar 64 px putih dengan **breadcrumb otomatis**, pencarian global (Ctrl+K), notifikasi
  antrean, dan **menu akun** (nama/peran, Pengaturan, Keluar); konten `max-w-[1400px]`,
  padding 16/24/32 px; drawer sidebar untuk tablet & ponsel.
- `src/layouts/PublicLayout.tsx` — header/footer putih untuk halaman publik.

**Komponen bersama** (`src/components/`)
- `ui/button.tsx`, `ui/card.tsx`, `ui/badge.tsx`, `ui/input.tsx`, `ui/select.tsx`,
  `ui/textarea.tsx`, `ui/checkbox.tsx`, `ui/label.tsx`, `ui/skeleton.tsx`, `ui/dialog.tsx`,
  `ui/table.tsx`
- `DataTable.tsx` — tabel profesional: header netral, tinggi baris nyaman, hover lembut,
  **pilihan jumlah baris per halaman (10/25/50/100)**, sorting, info "Menampilkan x–y dari n",
  empty & loading state.
- `PageHeader.tsx`, `StatCard.tsx`, `EmptyState.tsx`, `CrudPage.tsx`, `ConfirmDialog.tsx`.

**Halaman** — seluruh 43 halaman, termasuk Dashboard, Daftar Aset, Persediaan, Permintaan
(list/detail/form/upload), Transaksi (masuk, keluar, transfer, opname, kartu stok, riwayat, log),
Sisa Belum Terkirim, Live Stok, Laporan, Pindai Kode, Cetak Label, Master Data, Pengguna, Peran &
Izin, Audit Log, Pengaturan, Panel Super Admin, Landing, Login, Lupa/Reset Kata Sandi, 403, 404,
serta halaman publik (katalog & detail aset).

## 3. File yang dibuat / diubah

- **Dibuat:** `src/smoke.test.tsx` (pengujian render semua halaman + audit DOM).
- **Diubah:** 62 file, antara lain `tailwind.config.js`, `src/index.css`, `index.html`,
  `vite.config.ts`, `src/layouts/*`, `src/components/**`, `src/pages/*` (40 halaman),
  `src/features/**`, `src/routes/guards.tsx`.

## 4. Design system

| Token | Nilai | Pemakaian |
|---|---|---|
| Primary Red | `#C62828` | Tombol utama, menu aktif, ikon aksen |
| Deep Red | `#991B1B` | Hover/tekan, aksen kuat |
| Hover Red | `#B71C1C` | Hover tombol merah |
| Light Red BG | `#FEF2F2` | Latar menu aktif, badge, panel peringatan |
| Main Background | `#F7F8FA` | Latar area kerja |
| Surface | `#FFFFFF` | Kartu, sidebar, topbar, tabel |
| Primary Text | `#1F2937` | Judul & isi |
| Secondary Text | `#6B7280` | Teks pendukung |
| Border | `#E5E7EB` | Garis tipis kartu & tabel |
| Success / Warning / Error / Info | `#15803D` / `#D97706` / `#DC2626` / `#2563EB` | Status fungsional saja |

Tipografi: **Inter** (isi) + **Plus Jakarta Sans** (judul/kartu) + **JetBrains Mono** (angka & kode).
Hierarki: judul halaman 24 px/700, judul bagian 16–18 px/600, kartu 16 px/600, isi 14 px, tabel 13–14 px,
helper 12 px, tombol 14 px/500.
Radius kartu 12 px, radius kontrol 8 px, shadow sangat ringan, tanpa gradien mencolok.

## 5. Hasil build, lint & testing (benar-benar dijalankan)

| Perintah | Hasil |
|---|---|
| `npm run build` (tsc -b + vite build) | **Berhasil** — 2.719 modul, tanpa error tipe |
| `npx vitest run` | **111 lulus** (6 file) — 68 test lama + 43 test smoke baru |
| Audit DOM (bagian dari smoke test) | **0** temuan token tema lama di 43 halaman |

Smoke test baru (`src/smoke.test.tsx`) melakukan dua hal untuk setiap halaman:
1. Merender halaman dengan router & Supabase yang di-mock → memastikan halaman tetap berfungsi.
2. Memindai semua atribut `class` → memastikan tidak ada lagi kelas tema gelap lama
   (`slate-*`, `bg-ink-9xx`, `brand-3xx/4xx`, `rose/amber/sky/violet/emerald/teal-*`, dll).

Tidak ada skrip lint terpisah di proyek ini; pemeriksaan tipe berjalan lewat `tsc -b` pada build.

## 6. Masalah yang ditemukan & perbaikan

- **Tema gelap tersisa di banyak halaman** → dipetakan & dikonversi massal (247+ pemakaian
  `text-slate-*`, 132 `brand-*`, 62 `ink-*`), lalu diperiksa ulang per halaman.
- **Teks putih di atas latar yang kini terang** (tidak terbaca) → dikoreksi ke `text-ink-800`.
- **Kontras teks sekunder terlalu rendah** (`#9CA3AF` pada putih) → dinaikkan ke `#6B7280`.
- **Grafik Dashboard** masih memakai warna teal/ungu dan tooltip gelap → diganti ke palet
  merah/netral dengan tooltip putih.
- **Login/landing** kehilangan kontras panel setelah tema berubah → panel kiri dibuat putih.
- **Halaman 403/404** berupa teks lepas → dibungkus kartu agar konsisten.
- **Tab laporan & riwayat** berupa tombol campur → diubah menjadi tab bergaris bawah bergaya enterprise.
- **Label form tanpa pasangan input** di panel sinkron & filter permintaan → dihubungkan
  dengan `htmlFor`/`id`.
- **Tombol ikon tanpa label** di form permintaan → ditambahkan `title` + `aria-label`.
- **Loading state halaman detail permintaan** hanya teks → menjadi skeleton; layar loading guard
  diberi identitas merek.

## 7. Yang belum dapat diverifikasi

- **Tampilan dengan data asli & peran berbeda.** Di sandbox tidak ada kredensial Supabase
  (`.env` tidak ikut ter-commit), sehingga pratinjau hanya menampilkan Landing, Login,
  Lupa/Reset Kata Sandi, dan halaman publik. Halaman di dalam aplikasi sudah **diuji secara
  terprogram** (render + audit DOM), tetapi belum dilihat dengan data produksi.
- **Tangkapan layar per halaman** — sandbox tidak memiliki browser, jadi verifikasi visual
  dilakukan lewat audit DOM, bukan screenshot.
- **Perilaku cetak (print CSS)** pada Cetak Label tidak diubah, namun label dibuat di atas kanvas
  dan tidak terpengaruh tema UI.

## 8. Cara menjalankan & memeriksa hasil

```bash
npm install      # bila node_modules belum ada
npm run dev      # buka http://localhost:5173
npm test         # 111 pengujian
npm run build    # produksi
```

Untuk melihat dengan **data asli**, salin `.env.example` menjadi `.env` lalu isi
`VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY` (nilai yang sama dengan yang dipakai Vercel).

Perubahan sudah di-push ke branch `arena/7821c6bc-assetflow`. Situs produksi
(assetflow-opal.vercel.app) akan memakai tampilan baru **setelah branch ini digabung ke `main`**
dan Vercel melakukan deploy ulang.
