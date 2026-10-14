-- Katalog publik untuk master barang (inventory_items).
-- Dipakai halaman Katalog Aset Publik (opsi 1: tampilkan master barang).

CREATE OR REPLACE FUNCTION public.search_public_inventory(
  p_query    text    DEFAULT NULL,
  p_category text    DEFAULT NULL,
  p_limit    integer DEFAULT 20,
  p_offset   integer DEFAULT 0
)
RETURNS TABLE (
  sku        text,
  name       text,
  category   text,
  brand      text,
  model      text,
  unit       text,
  photo_url  text,
  total_stock numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    i.sku,
    i.name,
    c.name,
    i.brand,
    i.model,
    u.code,
    i.photo_url,
    COALESCE((
      SELECT SUM(b.qty) FROM public.inventory_balances b WHERE b.item_id = i.id
    ), 0)
  FROM public.inventory_items i
  LEFT JOIN public.categories c ON c.id = i.category_id
  LEFT JOIN public.units u ON u.id = i.unit_id
  WHERE i.is_active
    AND (
      NULLIF(btrim(COALESCE(p_category, '')), '') IS NULL
      OR c.name = btrim(p_category)
    )
    AND (
      NULLIF(btrim(COALESCE(p_query, '')), '') IS NULL
      OR i.name ILIKE '%' || btrim(p_query) || '%'
      OR i.sku ILIKE '%' || btrim(p_query) || '%'
      OR COALESCE(i.brand, '') ILIKE '%' || btrim(p_query) || '%'
      OR COALESCE(i.model, '') ILIKE '%' || btrim(p_query) || '%'
    )
  ORDER BY i.name
  LIMIT p_limit
  OFFSET p_offset
$$;

-- Izinkan anon + authenticated memanggil RPC katalog publik.
GRANT EXECUTE ON FUNCTION public.search_public_inventory(text, text, integer, integer) TO anon, authenticated;
