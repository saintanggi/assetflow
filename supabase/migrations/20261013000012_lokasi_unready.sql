-- Lokasi untuk kondisi UNREADY.
INSERT INTO public.locations (warehouse_id, code, name)
SELECT w.id, x.code, x.name
FROM public.warehouses w
JOIN (VALUES
  ('GUD-UTAMA', 'STOK-UNREADY', 'Stok Unready')
) AS x(wh_code, code, name) ON x.wh_code = w.code
ON CONFLICT (code) DO NOTHING;
