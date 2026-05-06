-- Add survey configuration to reminder_settings
ALTER TABLE public.reminder_settings
ADD COLUMN IF NOT EXISTS surveys_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS template_survey TEXT;

-- Comment: template_survey was previously in clinic_settings, 
-- but moving it here centralizes all automation rules.
