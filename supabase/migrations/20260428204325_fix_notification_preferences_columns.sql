-- Add missing columns to notification_preferences table

ALTER TABLE public.notification_preferences 
ADD COLUMN IF NOT EXISTS new_appointment BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS confirmed BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS completed BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS cancelled BOOLEAN DEFAULT true;
