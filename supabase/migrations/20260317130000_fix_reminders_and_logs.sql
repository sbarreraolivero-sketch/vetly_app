-- Create reminder_logs table
CREATE TABLE IF NOT EXISTS public.reminder_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
    appointment_id UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
    type TEXT NOT NULL, -- '24h', '2h', '1h'
    phone_number TEXT NOT NULL,
    status TEXT NOT NULL, -- 'sent', 'failed'
    error_message TEXT,
    sent_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_reminder_logs_clinic_id ON public.reminder_logs(clinic_id);
CREATE INDEX IF NOT EXISTS idx_reminder_logs_appointment_id ON public.reminder_logs(appointment_id);
CREATE INDEX IF NOT EXISTS idx_reminder_logs_created_at ON public.reminder_logs(created_at);

-- Enable RLS
ALTER TABLE public.reminder_logs ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Clinics can view their own reminder logs"
ON public.reminder_logs FOR SELECT
USING (clinic_id IN (
    SELECT clinic_id FROM public.user_profiles WHERE id = auth.uid()
));

-- Grant access
GRANT ALL ON public.reminder_logs TO authenticated;
GRANT ALL ON public.reminder_logs TO service_role;
