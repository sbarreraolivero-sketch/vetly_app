-- Programa el cron diario de la cola de envío de la campaña de prospección
-- (ver supabase/functions/cron-hq-prospecting-campaign/index.ts).
--
-- 15:00 UTC ≈ mañana en Chile/México/Colombia/Perú/Argentina — mismo criterio
-- horario que el cron de correos de onboarding (14:00 UTC), corrido 1h después
-- para no competir por los mismos recursos de Resend en el mismo instante.
--
-- Arranca inerte: prospecting_campaign_config.is_paused = true por defecto
-- (ver migración 20260901010500) — este cron corre todos los días desde ya,
-- pero no manda nada hasta que alguien lo active explícitamente desde el
-- panel /hq/prospecting.
SELECT cron.schedule(
    'hq-prospecting-campaign-daily',
    '0 15 * * *',
    $$
    select
      net.http_post(
          url:='https://ehmncwawzdciajvuallg.supabase.co/functions/v1/cron-hq-prospecting-campaign',
          headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVobW5jd2F3emRjaWFqdnVhbGxnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzg0Njg3OCwiZXhwIjoyMDg5NDIyODc4fQ.U0wzTI57FsfoPjLLR1h87kyoc5BMtE_Y7ztRVRigYDg"}'::jsonb,
          body:='{}'::jsonb
      ) as request_id;
    $$
);
