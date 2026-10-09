# AssetFlow — Rencana Implementasi

Sistem informasi manajemen aset tetap & persediaan gudang.
Stack: React + TS + Vite, Tailwind + shadcn/ui, Supabase (Postgres + Auth + Storage), Vercel.

## Kontrak Database (nama tabel & kolom kunci — WAJIB dipatuhi frontend & migrasi)

Semua tabel: PK `id uuid default gen_random_uuid()`, `created_at timestamptz default now()`,
`updated_at timestamptz default now()` (kecuali ledger/audit yang append-only).

| Tabel | Kolom kunci |
|---|---|
| profiles | id (FK auth.users), email, full_name, role_id FK roles, is_active bool |
| roles | name unique: `super_admin`, `admin` |
| permissions | code unique (lihat daftar), description |
| role_permissions | role_id, permission_id, unique(role_id, permission_id) |
| user_permissions | user_id FK profiles, permission_id, granted bool, granted_by, granted_at |
| asset_categories | code unique, name, description, is_active |
| warehouses | code unique, name, address, is_active |
| locations | warehouse_id FK, code unique, name, is_active |
| units | code unique, name, allow_decimal bool |
| departments | code unique, name |
| suppliers | code unique, name, contact, phone, address |
| assets | asset_code unique, public_code unique, name, category_id, brand, model, serial_number, purchase_date date, purchase_price numeric(15,2), location_id, department_id, custodian, condition (`baik`,`rusak_ringan`,`rusak_berat`), status (`tersedia`,`digunakan`,`dipinjamkan`,`perbaikan`,`rusak`,`dipensiunkan`), photo_url, is_published bool default false, published_at, published_by, archived bool default false, created_by |
| inventory_items | sku unique, name, category_id, brand, model, unit_id, barcode, min_stock numeric, location_id, supplier_id, purchase_price numeric(15,2), is_active bool, photo_url |
| inventory_balances | PK(item_id, location_id), qty numeric(15,3) |
| inventory_transactions | doc_number unique, type (`in`,`out`,`transfer`,`adjust`,`opname`,`return`), status (`draft`,`posted`,`reversed`), transaction_date, source_location_id, dest_location_id, reference, notes, idempotency_key unique, created_by, posted_at, reversed_at, reversal_of FK nullable, reversal_reason |
| inventory_transaction_items | transaction_id FK, item_id FK, qty numeric(15,3), unit_price numeric nullable, notes |
| inventory_ledger | transaction_id FK, item_id FK, location_id FK, qty_change numeric, qty_after numeric, created_at — append-only |
| asset_movements | asset_id FK, from_location_id, to_location_id, from_status, to_status, moved_by, notes |
| stock_counts | doc_number unique, location_id, status (`draft`,`posted`), counted_by, notes, posted_at |
| stock_count_items | stock_count_id FK, item_id FK, system_qty, counted_qty |
| audit_logs | actor_id FK profiles, action, entity_type, entity_id text, old_data jsonb, new_data jsonb |
| app_settings | key unique, value jsonb |

### Permission codes (minimal, sesuai spek)
`assets.view assets.create assets.update assets.archive assets.publish inventory.view
inventory.receive inventory.issue inventory.transfer inventory.adjust reports.view
reports.export labels.print users.manage settings.manage audit.view`

`assets.publish` hanya bisa diberikan oleh Super Admin (ditegakkan di RPC/politik).

### Fungsi helper (SECURITY DEFINER, schema public)
- `is_super_admin() bool` — role pemanggil = super_admin & aktif
- `has_permission(p_code text) bool` — super_admin → true; selain itu cek role_permissions / user_permissions
- `is_staff() bool` — role super_admin/admin & aktif

### RPC transaksi (atomik, row locking, idempotency)
- `post_inventory_transaction(p_idempotency_key, p_type, p_transaction_date, p_source_location_id, p_dest_location_id, p_reference, p_notes, p_items jsonb)` → validasi permission sesuai tipe (in→inventory.receive, out→inventory.issue, transfer→inventory.transfer, adjust/opname→inventory.adjust), lock `inventory_balances ... FOR UPDATE`, tolak keluar > stok, tulis transaction + items + ledger + update balances dalam 1 transaksi. Idempotency: key duplikat → kembalikan doc_number existing tanpa efek ganda.
- `reverse_inventory_transaction(p_transaction_id, p_reason)` → buat transaksi koreksi bertipe sama dengan qty dibalik, tandai asal `reversed`, catat reason/actor/waktu. Tidak mengubah histori asal.
- `finalize_stock_count(p_stock_count_id)` → hitung selisih, buat transaksi `opname` posted otomatis.
- `get_public_asset(p_public_code)` → kembalikan **hanya kolom whitelist**: public_code, name, category name, brand, model, condition, status, photo_url, department name, published_at. Hanya jika is_published=true dan archived=false.
- `search_public_assets(p_query, p_category, p_limit, p_offset)` → whitelist yang sama.

### RLS (ringkas)
- Semua tabel: RLS aktif. Kebijakan pakai helper di atas (hindari rekursi: helper baca profiles/roles dengan SECURITY DEFINER).
- `anon`: hanya via RPC/view publik (get_public_asset, search_public_assets). Tidak ada SELECT langsung ke tabel privat.
- `authenticated` + staff: SELECT/INSERT/UPDATE sesuai permission; DELETE dilarang di tabel transaksional (pakai archived/status).
- `audit_logs`: INSERT via trigger/fungsi; SELECT hanya super_admin.
- `app_settings`: tulis super_admin saja.

### Storage
Bucket `asset-photos`: baca publik, tulis authenticated (batas 5MB, tipe image/*).

### Bootstrap Super Admin
`supabase/bootstrap/superadmin.sql` — dijalankan manual oleh pemilik proyek di SQL Editor
**setelah** user pertama dibuat via Supabase Auth. Script hanya mempromosikan email
tertentu menjadi super_admin **jika belum ada super_admin sama sekali**. Tanpa kredensial default.

## Tahap pengerjaan
1. Migrasi DB (skema → RLS → fungsi → seed) + tes SQL RLS
2. Auth, role guard, layout, routing (30 halaman sesuai spek H)
3. Modul aset + QR (qrcode.react, html5-qrcode)
4. Modul inventory + barcode (jsbarcode) + transaksi via RPC
5. Dashboard + laporan (Recharts, TanStack Table, ekspor CSV/Excel)
6. Dashboard publik + whitelist
7. Audit log viewer, master data, user management, settings
8. Vitest + RTL; build production; docs deployment & rollback
