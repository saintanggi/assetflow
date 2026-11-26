-- =============================================================================
-- Migrasi: Normalisasi min_stock NULL -> 0 pada BEFORE INSERT inventory_items
-- =============================================================================
-- Kolom inventory_items.min_stock bertipe NOT NULL DEFAULT 0. Jika client
-- mengirim eksplisit {"min_stock": null}, Postgres tidak memakai DEFAULT dan
-- menolak INSERT. Trigger trg_items_bi menormalkan NULL -> 0 sebelum check.

CREATE OR REPLACE FUNCTION public.inventory_items_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.barcode IS NULL OR btrim(NEW.barcode) = '' THEN
    NEW.barcode := NEW.sku;
  END IF;
  IF NEW.min_stock IS NULL THEN
    NEW.min_stock := 0;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.inventory_items_before_insert() FROM PUBLIC;
