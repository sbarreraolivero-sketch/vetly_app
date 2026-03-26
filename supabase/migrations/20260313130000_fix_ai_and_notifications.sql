-- Migration to fix AI responsiveness and persistent notifications
-- 1. Add is_read to messages table
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT false;

-- 2. Create reminder_logs table for summary
CREATE TABLE IF NOT EXISTS public.reminder_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id UUID REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
    appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
    type TEXT NOT NULL, -- '24h', '2h', '1h'
    phone_number TEXT NOT NULL,
    status TEXT NOT NULL, -- 'sent', 'failed'
    error_message TEXT,
    sent_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for performance on summary queries
CREATE INDEX IF NOT EXISTS idx_reminder_logs_clinic_id ON public.reminder_logs(clinic_id);
CREATE INDEX IF NOT EXISTS idx_reminder_logs_sent_at ON public.reminder_logs(sent_at);

-- RLS for reminder_logs
ALTER TABLE public.reminder_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to reminder_logs"
  ON public.reminder_logs FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Clinic members can read own reminder_logs"
  ON public.reminder_logs FOR SELECT
  USING (public.is_clinic_member(clinic_id));
