-- Nomor label global, bukan penghitung di browser. Semua penerbitan melalui RPC.
CREATE TABLE public.qr_label_counter (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_number bigint NOT NULL DEFAULT 0 CHECK (last_number BETWEEN 0 AND 999999999999)
);
-- Mulai di atas nomor numerik lama yang sudah dikenal sistem (maks. 12 digit).
-- Tidak mengubah barcode lama, termasuk field multi-baris hasil impor.
INSERT INTO public.qr_label_counter (id, last_number)
SELECT true, coalesce(max(value::bigint), 0)
FROM (
  SELECT btrim(asset_code) AS value FROM public.assets
  UNION ALL SELECT btrim(sku) FROM public.inventory_items
  UNION ALL SELECT btrim(barcode) FROM public.inventory_items
  UNION ALL SELECT btrim(b.value) FROM public.request_items r
    CROSS JOIN LATERAL regexp_split_to_table(coalesce(r.barcode, ''), E'[\\r\\n,;]+') b(value)
) legacy WHERE value ~ '^[0-9]{1,12}$';

CREATE TABLE public.qr_label_batches (
  id uuid PRIMARY KEY, -- request UUID juga menjadi kunci idempotensi
  asset_id uuid REFERENCES public.assets(id) ON DELETE RESTRICT,
  item_id uuid REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  title text NOT NULL,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 500),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(asset_id, item_id) = 1),
  CHECK (asset_id IS NULL OR quantity = 1)
);
-- Satu aset fisik hanya mendapat satu nomor; barang/SKU bisa mempunyai banyak unit.
CREATE UNIQUE INDEX qr_label_one_per_asset ON public.qr_label_batches(asset_id) WHERE asset_id IS NOT NULL;

CREATE TABLE public.qr_serial_labels (
  number bigint PRIMARY KEY CHECK (number BETWEEN 1 AND 999999999999),
  code text GENERATED ALWAYS AS (lpad(number::text, 12, '0')) STORED UNIQUE,
  batch_id uuid NOT NULL REFERENCES public.qr_label_batches(id) ON DELETE RESTRICT
);
CREATE INDEX qr_serial_labels_batch ON public.qr_serial_labels(batch_id, number);
CREATE INDEX qr_label_batches_created ON public.qr_label_batches(created_at DESC);

ALTER TABLE public.qr_label_counter ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qr_label_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qr_serial_labels ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qr_label_counter, public.qr_label_batches, public.qr_serial_labels FROM anon, authenticated;
GRANT SELECT ON public.qr_label_batches, public.qr_serial_labels TO authenticated;
CREATE POLICY qr_label_batches_read ON public.qr_label_batches FOR SELECT TO authenticated
  USING (public.has_permission('labels.print'));
CREATE POLICY qr_serial_labels_read ON public.qr_serial_labels FOR SELECT TO authenticated
  USING (public.has_permission('labels.print'));

CREATE OR REPLACE FUNCTION public.allocate_qr_labels(
  p_request_id uuid,
  p_quantity integer,
  p_asset_id uuid DEFAULT NULL,
  p_item_id uuid DEFAULT NULL
) RETURNS SETOF public.qr_serial_labels
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_last bigint;
  v_batch public.qr_label_batches%ROWTYPE;
  v_title text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission('labels.print') THEN
    RAISE EXCEPTION 'Tidak memiliki izin cetak label' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 500
    OR num_nonnulls(p_asset_id, p_item_id) <> 1
    OR (p_asset_id IS NOT NULL AND p_quantity <> 1) THEN
    RAISE EXCEPTION 'Pilih satu aset (1 label) atau barang (1–500 label)';
  END IF;

  -- Satu transaksi memesan satu rentang utuh. Lock berlaku lintas user/perangkat.
  SELECT last_number INTO v_last FROM public.qr_label_counter WHERE id = true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Penghitung QR tidak ditemukan. Hubungi administrator'; END IF;
  SELECT * INTO v_batch FROM public.qr_label_batches WHERE id = p_request_id;
  IF FOUND THEN
    IF v_batch.created_by <> auth.uid() OR v_batch.quantity <> p_quantity
      OR v_batch.asset_id IS DISTINCT FROM p_asset_id OR v_batch.item_id IS DISTINCT FROM p_item_id THEN
      RAISE EXCEPTION 'Kunci permintaan sudah digunakan untuk data berbeda';
    END IF;
    RETURN QUERY SELECT * FROM public.qr_serial_labels WHERE batch_id = v_batch.id ORDER BY number;
    RETURN;
  END IF;

  -- Permintaan aset yang sama, termasuk dari pengguna lain, selalu mengembalikan nomor lama.
  IF p_asset_id IS NOT NULL THEN
    SELECT * INTO v_batch FROM public.qr_label_batches WHERE asset_id = p_asset_id;
    IF FOUND THEN
      RETURN QUERY SELECT * FROM public.qr_serial_labels WHERE batch_id = v_batch.id ORDER BY number;
      RETURN;
    END IF;
    SELECT name INTO v_title FROM public.assets WHERE id = p_asset_id AND NOT archived;
  ELSE
    SELECT name INTO v_title FROM public.inventory_items WHERE id = p_item_id;
  END IF;
  IF v_title IS NULL THEN RAISE EXCEPTION 'Aset/barang tidak ditemukan atau diarsipkan'; END IF;
  IF v_last + p_quantity > 999999999999 THEN RAISE EXCEPTION 'Nomor label sudah mencapai batas'; END IF;

  INSERT INTO public.qr_label_batches(id, asset_id, item_id, title, quantity, created_by)
    VALUES (p_request_id, p_asset_id, p_item_id, v_title, p_quantity, auth.uid());
  INSERT INTO public.qr_serial_labels(number, batch_id)
    SELECT n, p_request_id FROM generate_series(v_last + 1, v_last + p_quantity) AS n;
  UPDATE public.qr_label_counter SET last_number = v_last + p_quantity WHERE id = true;
  RETURN QUERY SELECT * FROM public.qr_serial_labels WHERE batch_id = p_request_id ORDER BY number;
END;
$$;
REVOKE ALL ON FUNCTION public.allocate_qr_labels(uuid, integer, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_qr_labels(uuid, integer, uuid, uuid) TO authenticated;

-- Scanner tidak memerlukan izin MENCETAK untuk membaca identitas target.
-- Hanya kembalikan metadata target yang memang boleh dilihat pengguna;
-- jangan membuka riwayat penerbit/penghitung kepada akun scanner.
CREATE OR REPLACE FUNCTION public.resolve_qr_label(p_code text)
RETURNS TABLE(kind text, id uuid, code text, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT 'asset'::text, a.id, a.asset_code, a.name
  FROM public.qr_serial_labels l
  JOIN public.qr_label_batches b ON b.id = l.batch_id
  JOIN public.assets a ON a.id = b.asset_id
  WHERE l.code = p_code AND auth.uid() IS NOT NULL AND public.has_permission('assets.view')
  UNION ALL
  SELECT 'item'::text, i.id, i.sku, i.name
  FROM public.qr_serial_labels l
  JOIN public.qr_label_batches b ON b.id = l.batch_id
  JOIN public.inventory_items i ON i.id = b.item_id
  WHERE l.code = p_code AND auth.uid() IS NOT NULL AND public.has_permission('inventory.view');
$$;
REVOKE ALL ON FUNCTION public.resolve_qr_label(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_qr_label(text) TO authenticated;
