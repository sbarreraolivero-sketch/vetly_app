
-- Migration: Repair appointments table columns
-- Some columns used by the AI and Frontend might be missing due to skipped migrations.

-- Ensure tutor_name column
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'appointments' AND column_name = 'tutor_name') THEN
        ALTER TABLE public.appointments ADD COLUMN tutor_name TEXT;
    END IF;
END $$;

-- Ensure duration column (some parts use duration, some duration_minutes)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'appointments' AND column_name = 'duration') THEN
        ALTER TABLE public.appointments ADD COLUMN duration INTEGER DEFAULT 60;
    END IF;
END $$;

-- Ensure price column
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'appointments' AND column_name = 'price') THEN
        ALTER TABLE public.appointments ADD COLUMN price NUMERIC DEFAULT 0;
    END IF;
END $$;

-- Ensure latitude/longitude for tracking mobile service location per appointment
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'appointments' AND column_name = 'latitude') THEN
        ALTER TABLE public.appointments ADD COLUMN latitude NUMERIC;
    END IF;
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'appointments' AND column_name = 'longitude') THEN
        ALTER TABLE public.appointments ADD COLUMN longitude NUMERIC;
    END IF;
END $$;

COMMENT ON COLUMN public.appointments.tutor_name IS 'Cached tutor name for easy display';
COMMENT ON COLUMN public.appointments.price IS 'Service price at the time of booking';
