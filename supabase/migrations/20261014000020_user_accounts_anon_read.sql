-- FIX: izinkan anon membaca user_accounts untuk lookup username saat login.
-- Tanpa ini, halaman login (belum auth) tidak bisa mapping username -> email.

DROP POLICY IF EXISTS "user_accounts anon login lookup" ON public.user_accounts;
CREATE POLICY "user_accounts anon login lookup"
ON public.user_accounts FOR SELECT
TO anon
USING (true);
