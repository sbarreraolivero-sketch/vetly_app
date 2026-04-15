-- Add global reminder template settings to clinic_settings
ALTER TABLE public.clinic_settings 
ADD COLUMN IF NOT EXISTS vaccine_reminder_template TEXT,
ADD COLUMN IF NOT EXISTS deworming_reminder_template TEXT;

-- Update existing column for survey if needed? No, focus on what requested.
