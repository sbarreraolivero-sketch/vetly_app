-- =============================================
-- FIX: Crons adicionales con problemas
-- =============================================
-- 1. process-surveys-hourly  → usaba anon key (necesita service_role)
-- 2. retention-compute-daily → apuntaba al proyecto VIEJO
-- =============================================

-- Claves del proyecto correcto (ehmncwawzdciajvuallg)
-- service_role: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVobW5jd2F3emRjaWFqdnVhbGxnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzg0Njg3OCwiZXhwIjoyMDg5NDIyODc4fQ.U0wzTI57FsfoPjLLR1h87kyoc5BMtE_Y7ztRVRigYDg

-- ─────────────────────────────────────────────────
-- FIX 1: process-surveys-hourly (cambia anon → service_role)
-- ─────────────────────────────────────────────────
SELECT cron.unschedule('process-surveys-hourly');

SELECT cron.schedule(
    'process-surveys-hourly',
    '0 * * * *',
    $$
    select net.http_post(
        url:='https://ehmncwawzdciajvuallg.supabase.co/functions/v1/cron-process-surveys',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVobW5jd2F3emRjaWFqdnVhbGxnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzg0Njg3OCwiZXhwIjoyMDg5NDIyODc4fQ.U0wzTI57FsfoPjLLR1h87kyoc5BMtE_Y7ztRVRigYDg"}'::jsonb,
        body:='{}'::jsonb
    ) as request_id;
    $$
);

-- ─────────────────────────────────────────────────
-- FIX 2: retention-compute-daily (apuntaba a proyecto viejo)
-- ─────────────────────────────────────────────────
SELECT cron.unschedule('retention-compute-daily');

SELECT cron.schedule(
    'retention-compute-daily',
    '0 3 * * *',
    $$
    select net.http_post(
        url:='https://ehmncwawzdciajvuallg.supabase.co/functions/v1/cron-retention-compute',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVobW5jd2F3emRjaWFqdnVhbGxnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzg0Njg3OCwiZXhwIjoyMDg5NDIyODc4fQ.U0wzTI57FsfoPjLLR1h87kyoc5BMtE_Y7ztRVRigYDg"}'::jsonb,
        body:='{}'::jsonb
    ) as request_id;
    $$
);

-- ─────────────────────────────────────────────────
-- Verificar estado final de todos los crons
-- ─────────────────────────────────────────────────
SELECT jobname, schedule,
    CASE 
        WHEN command LIKE '%ehmncwawzdciajvuallg%' AND command LIKE '%service_role%' THEN '✅ OK'
        WHEN command LIKE '%hubjqllcmbzoojyidgcu%' THEN '❌ Proyecto viejo'
        WHEN command LIKE '%anon%' THEN '⚠️ Usa anon key'
        ELSE '⚠️ Revisar'
    END AS estado
FROM cron.job
ORDER BY jobname;
