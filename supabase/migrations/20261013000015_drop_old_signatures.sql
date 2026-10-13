-- 20261013000015 — Hapus signature lama yang duplikat (bikin ambiguous).
DROP FUNCTION IF EXISTS public.ship_request_items(uuid, uuid, jsonb, text);
DROP FUNCTION IF EXISTS public._change_balance(uuid, uuid, numeric, uuid);
DROP FUNCTION IF EXISTS public._apply_posted_effects(uuid);
