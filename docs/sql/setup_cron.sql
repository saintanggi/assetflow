-- =============================================================================
-- JADWAL SINKRON OTOMATIS TIAP 15 MENIT (pg_cron) — 1x copas
-- =============================================================================
-- SEBELUM MENJALANKAN, GANTI DUA TEMPAT BERIKUT:
--   <PROJECT-REF>        → lihat: Supabase Dashboard → Project Settings → General → "Reference ID"
--                          (juga terlihat di URL dashboard: supabase.com/dashboard/project/xxxxxxxx)
--   <SERVICE-ROLE-KEY>   → lihat: Project Settings → API Keys → bagian "service_role" → klik Reveal/Copy
--
--   CATATAN: service_role key itu RAHASIA (setara password admin). Jangan dibagikan
--   ke siapa pun dan jangan ditaruh di chat/WhatsApp. SQL ini hanya disimpan di
--   database kamu sendiri.
--
-- Kalau nama fungsi Edge kamu BUKAN "sync-sheets", ganti juga bagian /sync-sheets di URL.
-- =============================================================================

-- 1) Aktifkan penjadwal + pemanggil HTTP
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2) Jadwalkan tiap 15 menit (ganti 2 placeholder di bawah!)
SELECT cron.schedule(
  'sync-google-sheet-pengiriman',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://<PROJECT-REF>.supabase.co/functions/v1/sync-sheets',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer <SERVICE-ROLE-KEY>'
               ),
    body    := jsonb_build_object('action', 'run')
  ) AS request_id;
  $$
);

-- 3) Cek jadwal aktif
SELECT jobid, jobname, schedule, active FROM cron.job;

-- 4) (Opsional) lihat hasil eksekusi terakhir
SELECT status, return_message, start_time
FROM cron.job_run_details
ORDER BY start_time DESC
LIMIT 10;

-- 5) Cara MATIKAN jadwal (kalau ingin berhenti):
-- SELECT cron.unschedule('sync-google-sheet-pengiriman');
