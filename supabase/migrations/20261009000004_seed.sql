-- =============================================================
-- AssetFlow — Migrasi 000004: Seed (idempoten)
-- =============================================================
-- Aman dijalankan ulang: semua INSERT memakai ON CONFLICT DO NOTHING.
-- Dijalankan sebagai postgres (melewati RLS); trigger guard
-- mengizinkan karena auth.uid() IS NULL pada konteks ini.
-- =============================================================

-- ---------- roles ----------
INSERT INTO public.roles (name, description)
VALUES
  ('super_admin', 'Akses penuh ke seluruh sistem dan konfigurasi'),
  ('admin',       'Operator gudang; hak akses sesuai permission yang diberikan')
ON CONFLICT (name) DO NOTHING;

-- ---------- permissions (15 kode sesuai kontrak) ----------
INSERT INTO public.permissions (code, description)
VALUES
  ('assets.view',      'Melihat daftar dan detail aset tetap'),
  ('assets.create',    'Menambah aset tetap baru'),
  ('assets.update',    'Mengubah data aset tetap'),
  ('assets.archive',   'Mengarsipkan / memensiunkan aset tetap'),
  ('assets.publish',   'Mempublikasikan aset ke dashboard publik (pemberian: Super Admin saja)'),
  ('inventory.view',   'Melihat stok dan barang persediaan'),
  ('inventory.receive','Mencatat barang masuk & mengelola data barang'),
  ('inventory.issue',  'Mencatat barang keluar'),
  ('inventory.transfer','Mencatat transfer stok antar lokasi'),
  ('inventory.adjust', 'Penyesuaian stok dan stock opname'),
  ('reports.view',     'Melihat laporan'),
  ('reports.export',   'Mengekspor laporan (CSV/Excel)'),
  ('labels.print',     'Mencetak label QR Code / barcode'),
  ('users.manage',     'Mengelola akun pengguna (Super Admin)'),
  ('settings.manage',  'Mengubah pengaturan & konfigurasi aplikasi (Super Admin)'),
  ('audit.view',       'Melihat audit log (Super Admin)')
ON CONFLICT (code) DO NOTHING;

-- ---------- role_permissions ----------
-- super_admin: semua permission.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'super_admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- admin: semua KECUALI users.manage, settings.manage, audit.view, assets.publish.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'admin'
  AND p.code NOT IN ('users.manage', 'settings.manage', 'audit.view', 'assets.publish')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ---------- units ----------
INSERT INTO public.units (code, name, allow_decimal)
VALUES
  ('pcs',   'Pcs',      false),
  ('unit',  'Unit',     false),
  ('box',   'Box',      false),
  ('pack',  'Pack',     false),
  ('meter', 'Meter',    true),
  ('liter', 'Liter',    true),
  ('kg',    'Kilogram', true)
ON CONFLICT (code) DO NOTHING;

-- ---------- asset_categories ----------
INSERT INTO public.asset_categories (code, name, description)
VALUES
  ('ELK',  'Elektronik',        'Komputer, laptop, printer, dan perangkat elektronik'),
  ('FURN', 'Furniture',         'Meja, kursi, lemari, dan perabot kantor'),
  ('KEND', 'Kendaraan',         'Kendaraan operasional perusahaan'),
  ('ALAT', 'Peralatan',         'Perkakas dan alat kerja'),
  ('ATK',  'ATK & Habis Pakai', 'Alat tulis kantor dan barang habis pakai')
ON CONFLICT (code) DO NOTHING;

-- ---------- warehouses ----------
INSERT INTO public.warehouses (code, name, address)
VALUES
  ('GUD-UTAMA',  'Gudang Utama',  'Jl. Raya Utama No. 1, Jakarta'),
  ('GUD-CABANG', 'Gudang Cabang', 'Jl. Cabang No. 2, Bandung')
ON CONFLICT (code) DO NOTHING;

-- ---------- locations ----------
INSERT INTO public.locations (warehouse_id, code, name)
SELECT w.id, x.code, x.name
FROM public.warehouses w
JOIN (VALUES
  ('GUD-UTAMA',  'RAK-A1', 'Rak A1'),
  ('GUD-UTAMA',  'RAK-A2', 'Rak A2'),
  ('GUD-CABANG', 'RAK-B1', 'Rak B1')
) AS x(wh_code, code, name) ON x.wh_code = w.code
ON CONFLICT (code) DO NOTHING;

-- ---------- departments ----------
INSERT INTO public.departments (code, name)
VALUES
  ('IT',  'Departemen IT'),
  ('HRD', 'Human Resources'),
  ('OPS', 'Operasional'),
  ('FIN', 'Keuangan'),
  ('MKT', 'Marketing')
ON CONFLICT (code) DO NOTHING;

-- ---------- suppliers (contoh) ----------
INSERT INTO public.suppliers (code, name, contact, phone, address)
VALUES
  ('SUP-001', 'PT Maju Jaya Abadi',  'Budi', '0812-0000-0001', 'Jakarta'),
  ('SUP-002', 'CV Berkah Stationery','Siti', '0812-0000-0002', 'Bandung')
ON CONFLICT (code) DO NOTHING;

-- ---------- app_settings ----------
INSERT INTO public.app_settings (key, value)
VALUES
  ('app.name',            '"AssetFlow"'),
  ('app.photo_max_mb',    '5'),
  ('app.photo_mimetypes', '["image/jpeg", "image/png", "image/webp"]')
ON CONFLICT (key) DO NOTHING;
