-- Add template selection columns to reminder_settings
ALTER TABLE public.reminder_settings
ADD COLUMN IF NOT EXISTS template_24h TEXT,
ADD COLUMN IF NOT EXISTS template_2h TEXT,
ADD COLUMN IF NOT EXISTS template_1h TEXT,
ADD COLUMN IF NOT EXISTS template_confirmation TEXT,
ADD COLUMN IF NOT EXISTS template_followup TEXT;

-- Add template selection columns to clinic_settings
ALTER TABLE public.clinic_settings
ADD COLUMN IF NOT EXISTS template_survey TEXT,
ADD COLUMN IF NOT EXISTS template_reactivation TEXT;
