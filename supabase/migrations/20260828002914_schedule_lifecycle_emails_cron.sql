-- Programa el cron diario de la secuencia de correos de onboarding/retención
-- (ver supabase/functions/cron-lifecycle-emails/index.ts).
--
-- 14:00 UTC ≈ mañana en Chile/México/Colombia/Perú, tarde en España — única
-- franja razonable para cubrir en un solo envío diario todos los países que
-- ofrece el selector de país del registro. No se localiza por zona horaria
-- del destinatario — decisión consciente para no sumar esa complejidad en
-- esta primera versión.
--
-- A diferencia del job de recordatorios de la llamada de activación HQ
-- (creado a mano en producción sin migración en el repo), este sí queda
-- versionado desde el día uno.
SELECT cron.schedule(
    'lifecycle-emails-daily',
    '0 14 * * *',
    $$
    select
      net.http_post(
          url:='https://ehmncwawzdciajvuallg.supabase.co/functions/v1/cron-lifecycle-emails',
          headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVobW5jd2F3emRjaWFqdnVhbGxnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzg0Njg3OCwiZXhwIjoyMDg5NDIyODc4fQ.U0wzTI57FsfoPjLLR1h87kyoc5BMtE_Y7ztRVRigYDg"}'::jsonb,
          body:='{}'::jsonb
      ) as request_id;
    $$
);
