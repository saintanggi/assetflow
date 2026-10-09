# AssetFlow — Dokumentasi Database

> Bahasa: Indonesia. Berlaku untuk migrasi `supabase/migrations/20261009000001`–`000004`.
> Kontrak resmi: `docs/IMPLEMENTATION_PLAN.md` (nama tabel/kolom/fungsi di sana wajib dipatuhi).

## 1. Gambaran umum

- **PostgreSQL 15** via Supabase. Semua tabel di schema `public`.
- Konvensi: PK `id uuid default gen_random_uuid()` (kecuali `inventory_balances`
  yang memakai composite PK `(item_id, location_id)` sesuai kontrak),
  `created_at`/`updated_at` otomatis via trigger — kecuali `inventory_ledger`
  dan `audit_logs` yang **append-only** (tanpa `updated_at`, tanpa UPDATE/DELETE).
- **Tidak ada view.** Akses publik hanya lewat dua RPC `SECURITY DEFINER`
  (`get_public_asset`, `search_public_assets`) dengan whitelist kolom eksplisit.
- Semua fungsi `SECURITY DEFINER` memakai `SET search_path = public, extensions`
  (tetap — anti pembajakan search_path). Hak `CREATE` pada schema `public`
  dicabut dari `PUBLIC` sebagai hardening tambahan.

## 2. Diagram relasi (tekstual)

```
auth.users (milik Supabase Auth)
    |
    | 1:1  (ON DELETE CASCADE)
    v
profiles -----> roles  (role_id, NULL = belum diberi role)
    |               |
    |               +---> role_permissions ---> permissions
    |
    +---> user_permissions ---> permissions   (override per-user; granted=false = tolak)
```

```
warehouses ---> locations ---> assets ---> asset_categories
    1:N            1:N            |
                                 +---> departments
                                 +---> asset_movements (riwayat lokasi/status)

units ---> inventory_items ---> asset_categories
              | 1:N                |
              +---> suppliers      +---> locations (lokasi penyimpanan default)
              |
              +---> inventory_balances (PK: item_id, location_id)
                        ^
                        | ditulis HANYA oleh RPC
                        |
inventory_transactions ---> inventory_transaction_items
    | 1:N                       (UNIQUE transaction_id, item_id)
    +---> inventory_ledger (append-only: qty_change, qty_after)
    +---> reversal_of (self-FK ke transaksi asal, untuk koreksi)

stock_counts ---> stock_count_items ---> inventory_items
    (draft -> posted via finalize_stock_count())

profiles ---> audit_logs (ditulis trigger; SELECT: super_admin saja)
app_settings (key UNIQUE, value jsonb; tulis: super_admin saja)

doc_counters (internal: prefix, year, last_number) -> penomoran dokumen anti-race
```

## 3. Deskripsi tabel

### 3.1 Identitas & otorisasi

| Tabel | Isi & aturan penting |
|---|---|
| `roles` | `name` unik: `super_admin`, `admin`. |
| `permissions` | 15 kode (lihat §6). `code` unik. |
| `role_permissions` | Unik `(role_id, permission_id)`. Tulis: super_admin saja. Trigger menolak pemberian `assets.publish` oleh non-super_admin (lapis kedua; RLS sudah membatasi). |
| `profiles` | `id` = `auth.users.id`. `role_id` boleh NULL (user baru tanpa hak apa pun sampai ditetapkan). Baca: profil sendiri / super_admin (semua) / staff membaca user aktif. Tulis: super_admin atau `users.manage`. **Perubahan `role_id`/`is_active` oleh non-super_admin ditolak trigger** (anti privilege escalation). |
| `user_permissions` | Override per-user. `granted=false` eksplisit **menang** atas role. Tulis: super_admin saja. |

### 3.2 Master data

`asset_categories`, `warehouses`, `locations` (FK `warehouse_id`; `code` unik global),
`units` (`allow_decimal`: `pcs/unit/box/pack` = false, `meter/liter/kg` = true —
ditegakkan di RPC transaksi), `departments`, `suppliers`.
Baca: staff. Tulis: super_admin saja.

### 3.3 Aset tetap (`assets`)

Satu baris = satu unit fisik (UUID + `asset_code` unik + `public_code` unik untuk QR).
`condition`: `baik | rusak_ringan | rusak_berat`.
`status`: `tersedia | digunakan | dipinjamkan | perbaikan | rusak | dipensiunkan`.
`is_published` default false; publikasi butuh `assets.publish` (trigger mengisi
`published_at`/`published_by` otomatis, membersihkannya saat publikasi dicabut).
`archived=true` butuh `assets.archive`; **hard DELETE ditolak untuk semua role**
(tidak ada policy DELETE) — data yang sudah punya riwayat hanya diarsipkan.
Kolom privat (`purchase_price`, `serial_number`, `custodian`, identitas admin)
tidak pernah keluar lewat RPC publik.

### 3.4 Persediaan (`inventory_items`, `inventory_balances`)

Satu SKU = satu jenis barang. `barcode` unik, default = `sku` (diisi trigger;
Code 128 dibuat dari barcode/SKU). `min_stock`, `qty` presisi `numeric(15,3)`.
Saldo per `(item_id, location_id)` — **hanya ditulis oleh RPC** (tidak ada policy
tulis; RLS menolak INSERT/UPDATE/DELETE langsung).

### 3.5 Transaksi (`inventory_transactions`, `..._items`, `inventory_ledger`)

- `doc_number` unik, format `PREFIX-YYYY-NNNNNN` (`IN/OUT/TRF/ADJ/OPN/RTN/REV/SO`),
  dibuat oleh `next_doc_number()` (counter per prefix+tahun, `FOR UPDATE` — aman race).
- `type`: `in | out | transfer | adjust | opname | return`.
  `status`: `draft | posted | reversed`.
- **Tulis langsung via API ditolak** (tidak ada policy INSERT/UPDATE/DELETE):
  posting hanya lewat `post_inventory_transaction()` (langsung `posted`),
  koreksi hanya lewat `reverse_inventory_transaction()` (transaksi asal jadi
  `reversed`, histori tidak diubah).
- `idempotency_key` unik: key duplikat mengembalikan `doc_number` lama
  **tanpa efek ganda**, termasuk saat dua request balapan (ditangani via
  `unique_violation` di dalam RPC).
- `inventory_ledger` append-only: setiap perubahan saldo menulis
  `(qty_change, qty_after)` — tidak bisa diubah/dihapus aplikasi.

### 3.6 Stock opname (`stock_counts`, `stock_count_items`)

Opname dibuat sebagai `draft` (butuh `inventory.adjust`), item dihitung
(`counted_qty`; NULL = belum dihitung). `finalize_stock_count()`:
mengunci opname, me-refresh `system_qty` dari saldo aktual (kunci baris),
menolak item yang belum dihitung, memposting selisih sebagai transaksi
`opname`, lalu status jadi `posted`. Status `posted` tidak bisa ditulis
langsung (WITH CHECK menolak) — hanya via RPC.

### 3.7 Lainnya

- `asset_movements`: riwayat lokasi/status aset. Tulis butuh `assets.update`;
  tidak bisa diubah/dihapus.
- `audit_logs`: ditulis trigger `log_audit()` (AFTER INSERT/UPDATE/DELETE pada
  `assets`, `inventory_items`, `inventory_transactions`, `profiles`) berisi
  `actor_id`, `action`, `entity_type`, `entity_id`, `old_data`/`new_data` (jsonb).
  SELECT: super_admin saja. INSERT langsung: super_admin saja (trigger
  mem-bypass RLS sebagai owner). **Tidak ada UPDATE/DELETE.**
- `app_settings`: baca semua user login; tulis super_admin saja.
- `doc_counters`: tabel internal penomoran; RLS aktif tanpa policy
  (hanya owner & fungsi `SECURITY DEFINER`).

## 4. RPC transaksi — alur & jaminan

```
post_inventory_transaction(idempotency_key, type, tgl, src, dst, ref, notes, items jsonb)
  1. validasi tipe + permission (in->receive, out->issue, transfer->transfer,
     adjust/opname->adjust, return->receive)
  2. validasi aturan lokasi per tipe (mis. transfer: src&dst wajib & berbeda)
  3. cek idempotency_key -> kalau ada, return doc_number lama (TANPA efek)
  4. buat doc_number via next_doc_number()  [catch unique_violation -> return lama]
  5. insert header (posted) + items
  6. _apply_posted_effects: untuk tiap item (urut item_id, anti-deadlock)
       - item harus aktif; qty bulat bila satuan allow_decimal=false
       - kunci saldo FOR UPDATE; tolak bila stok < kebutuhan (RAISE EXCEPTION)
       - update saldo + tulis ledger  -> SEMUA dalam 1 transaksi DB (atomik)
```

`reverse_inventory_transaction(txn_id, reason)` — mengunci transaksi asal
(`FOR UPDATE`), hanya `posted`; membuat transaksi koreksi bertipe sama dengan
qty dinegasi (+ cek stok untuk sisi pengurang), menandai asal `reversed` +
`reversed_at` + `reversal_reason` + `reversal_of`. Alasan wajib diisi.

## 5. RPC publik (untuk anon — tanpa login)

| Fungsi | Mengembalikan (whitelist) | Syarat |
|---|---|---|
| `get_public_asset(public_code)` | `public_code, name, category, brand, model, condition, status, photo_url, department, published_at` | `is_published=true` dan `archived=false` |
| `search_public_assets(query, category, limit, offset)` | kolom yang sama | sama; `limit` dibatasi maks 100 |

Kueri memakai parameter terikat (aman dari injeksi). QR Code aset berisi URL
`https://DOMAIN-APLIKASI/assets/public/{public_code}` — tanpa token/rahasia.

## 6. Permission codes

```
assets.view  assets.create  assets.update  assets.archive  assets.publish
inventory.view  inventory.receive  inventory.issue  inventory.transfer  inventory.adjust
reports.view  reports.export  labels.print
users.manage  settings.manage  audit.view
```

- `super_admin`: semua (via `has_permission()` -> true; tidak perlu baris role).
- `admin` (seed): semua **kecuali** `users.manage`, `settings.manage`,
  `audit.view`, `assets.publish`.
- `reports.view`/`reports.export`/`labels.print` diperiksa di backend
  (via `has_permission()`) sebelum render/ekspor/cetak.
- `assets.publish` hanya dapat **diberikan** oleh Super Admin (RLS tulis +
  trigger `guard_publish_grant`).

## 7. Matriks RLS (ringkas)

| Area | anon | authenticated non-staff | staff (admin) | super_admin |
|---|---|---|---|---|
| Tabel privat (SELECT langsung) | ❌ | ❌ | sesuai permission | ✅ |
| RPC publik (2 fungsi) | ✅ | ✅ | ✅ | ✅ |
| Master data tulis | ❌ | ❌ | ❌ | ✅ |
| Aset tulis | ❌ | ❌ | `assets.create/update` (+`publish`/`archive` khusus) | ✅ |
| Transaksi tulis langsung | ❌ | ❌ | ❌ (hanya via RPC) | ❌ (hanya via RPC) |
| `audit_logs` baca | ❌ | ❌ | ❌ | ✅ |
| `app_settings` tulis | ❌ | ❌ | ❌ | ✅ |
| `profiles` tulis | ❌ | profil sendiri (nama) | + `users.manage` | ✅ |

Fungsi helper (`is_super_admin`, `is_staff`, `has_permission`) hanya bisa
dieksekusi role `authenticated`; RPC transaksi hanya `authenticated`;
RPC publik `anon` + `authenticated`.

## 8. Storage

Bucket **`asset-photos`** (public read):
- `SELECT`: `anon` + `authenticated` (untuk foto aset yang dipublish).
- `INSERT`: `authenticated`.
- `UPDATE`/`DELETE`: pemilik file (`owner = auth.uid()`).

> **Batas 5MB & `image/*`**: tidak dapat ditegakkan andal di policy SQL
> (metadata file tidak tersedia/dipercaya saat evaluasi RLS), sehingga
> **wajib divalidasi di aplikasi** saat upload (client + edge/server).
> Nilai default tersimpan di `app_settings`
> (`app.photo_max_mb = 5`, `app.photo_mimetypes = [jpeg, png, webp]`).

## 9. Keputusan desain penting

1. **Tanpa view** — akses publik murni lewat RPC `SECURITY DEFINER` agar tidak
   ada celah RLS-bypass tak disengaja.
2. **Transaksi stok 100% via RPC** — validasi stok, penguncian baris, dan
   penulisan ledger terjadi di PostgreSQL, bukan di React. Frontend tidak
   bisa mengakali stok.
3. **Koreksi, bukan edit** — histori `posted` tidak pernah diubah; koreksi
   selalu transaksi baru yang tercatat (`reversal_of`, alasan, aktor, waktu).
4. **`user_permissions.granted=false` menang atas role** — pencabutan eksplisit.
5. **`role_id` NULL untuk user baru** — prinsip least privilege: user yang baru
   daftar tidak bisa apa-apa sampai diberi role.
6. **Trigger guard sebagai lapis kedua** — RLS adalah penegak utama; trigger
   (`guard_profile_privilege`, `guard_publish_grant`, `assets_before_write`)
   menutup celah update-mandiri (self-update) yang lolos USING/WITH CHECK.
7. **Doc number terpusat** — satu fungsi `next_doc_number()` dipakai RPC dan
   trigger, sehingga nomor unik & berurutan per prefix+tahun walau concurrent.
8. **`REVOKE CREATE ON SCHEMA public FROM PUBLIC`** — mencegah serangan
   shadowing nama pada fungsi `SECURITY DEFINER`.

## 10. Backup & restore

- **Backup**: Supabase Dashboard > Database > Backups (otomatis harian pada
  paket berbayar), atau manual: `pg_dump` via connection string
  (Dashboard > Project Settings > Database > Connection string):
  `pg_dump --format=custom -f assetflow-backup.dump "postgresql://..."`.
  Lakukan sebelum setiap deploy migrasi besar.
- **Restore**: `pg_restore -d "postgresql://..." assetflow-backup.dump`,
  atau Point-in-Time Recovery dari dashboard.
- **Rollback migrasi**: migrasi dirancang idempoten (`IF NOT EXISTS`,
  `DROP ... IF EXISTS`, `ON CONFLICT DO NOTHING`) sehingga aman dijalankan
  ulang; untuk rollback skema, siapkan migrasi korektif baru (jangan edit
  migrasi lama yang sudah terlanjur jalan di production).
- File sensitif (`.env`, service-role key) tidak pernah masuk Git
  (lihat `.env.example`).
