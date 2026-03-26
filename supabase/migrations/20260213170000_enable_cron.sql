-- =============================================
-- AUTOMATION & CRON JOBS SETUP
-- =============================================

-- 1. Create reminder_settings table (Required for automated reminders)
CREATE TABLE IF NOT EXISTS public.reminder_settings (
    clinic_id UUID PRIMARY KEY REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
    
    -- Rules
    reminder_24h_before BOOLEAN DEFAULT true,
    reminder_2h_before BOOLEAN DEFAULT true,
    reminder_1h_before BOOLEAN DEFAULT false,
    
    request_confirmation BOOLEAN DEFAULT true,
    confirmation_days_before INTEGER DEFAULT 1,
    
    preferred_hour TEXT DEFAULT '09:00', -- HH:MM format
    reminder_message TEXT DEFAULT '¡Hola {nombre}! Te recordamos tu cita...',
    
    followup_enabled BOOLEAN DEFAULT false,
    followup_days_after INTEGER DEFAULT 7,
    followup_message TEXT,
    
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS for reminder_settings
ALTER TABLE public.reminder_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read reminder_settings"
    ON public.reminder_settings FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update reminder_settings"
    ON public.reminder_settings FOR ALL
    USING (auth.role() = 'authenticated');
    
CREATE POLICY "Service role full access to reminder_settings"
    ON public.reminder_settings FOR ALL
    USING (auth.role() = 'service_role');


-- 2. Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 3. SCHEDULE: Process Surveys (Hourly)
SELECT cron.schedule(
    'process-surveys-hourly',
    '0 * * * *', -- Every hour at minute 0
    $$
    select
      net.http_post(
          url:='https://hubjqllcmbzoojyidgcu.supabase.co/functions/v1/cron-process-surveys',
          headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1YmpxbGxjbWJ6b29qeWlkZ2N1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDE0OTc3MCwiZXhwIjoyMDg1NzI1NzcwfQ.lnOepDZP07NwIvROxdHZG6sLST4vJs51QIDCQs7cF6o"}'::jsonb,
          body:='{}'::jsonb
      ) as request_id;
    $$
);

-- 4. SCHEDULE: Process Reminders (Hourly)
-- Checks for reminders to be sent (e.g., 24h before)
SELECT cron.schedule(
    'process-reminders-hourly',
    '0 * * * *', -- Every hour at minute 0
    $$
    select
      net.http_post(
          url:='https://hubjqllcmbzoojyidgcu.supabase.co/functions/v1/cron-process-reminders',
          headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1YmpxbGxjbWJ6b29qeWlkZ2N1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDE0OTc3MCwiZXhwIjoyMDg1NzI1NzcwfQ.lnOepDZP07NwIvROxdHZG6sLST4vJs51QIDCQs7cF6o"}'::jsonb,
          body:='{}'::jsonb
      ) as request_id;
    $$
);

-- NOTE:
-- Please replace YOUR_PROJECT_ID and YOUR_SERVICE_ROLE_KEY with your actual project details 
-- before running this in the Supabase SQL Editor.
