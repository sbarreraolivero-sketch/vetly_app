-- Migration: Add address column to appointments table
-- This is essential for mobile clinics to track the exact service location.

ALTER TABLE public.appointments 
ADD COLUMN IF NOT EXISTS address TEXT;

-- Verify if duration_minutes also needs to be present for backward/forward compatibility
-- seen in some parts of the system
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'appointments' AND column_name = 'duration_minutes') THEN
        ALTER TABLE public.appointments ADD COLUMN duration_minutes INTEGER;
    END IF;
END $$;

COMMENT ON COLUMN public.appointments.address IS 'Specific service location for the appointment (critical for mobile clinics)';
