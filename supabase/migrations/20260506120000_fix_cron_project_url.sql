-- =============================================
-- FIX CRON: Apuntar al proyecto correcto (ehmncwawzdciajvuallg)
-- =============================================
-- PROBLEMA: El cron anterior apuntaba a hubjqllcmbzoojyidgcu (proyecto viejo)
--           pero el proyecto activo es ehmncwawzdciajvuallg.
--           Por eso los recordatorios NUNCA se ejecutaban.
--
-- ANTES DE EJECUTAR: Obtén tu service_role key en:
--   Supabase Dashboard (ehmncwawzdciajvuallg) > Project Settings > API > service_role
-- y reemplaza [TU_SERVICE_ROLE_KEY] abajo.
-- =============================================

-- 1. Eliminar el cron antiguo (si existe en el proyecto viejo, ejecutar allá también)
SELECT cron.unschedule('process-reminders-hourly');

-- 2. Re-crear el cron apuntando al proyecto CORRECTO: ehmncwawzdciajvuallg
--    Se ejecuta cada hora en el minuto 0 (ej: 9:00, 10:00, 11:00...)
SELECT cron.schedule(
    'process-reminders-hourly',
    '0 * * * *',
    $$
    select
      net.http_post(
          url:='https://ehmncwawzdciajvuallg.supabase.co/functions/v1/cron-process-reminders',
          headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVobW5jd2F3emRjaWFqdnVhbGxnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzg0Njg3OCwiZXhwIjoyMDg5NDIyODc4fQ.U0wzTI57FsfoPjLLR1h87kyoc5BMtE_Y7ztRVRigYDg"}'::jsonb,
          body:='{}'::jsonb
      ) as request_id;
    $$
);

-- 3. Verificar los crons activos tras el cambio
SELECT jobname, schedule, command FROM cron.job ORDER BY jobname;
