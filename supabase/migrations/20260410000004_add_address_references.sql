
-- Migration: Add address_references to appointments
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'appointments' AND column_name = 'address_references') THEN
        ALTER TABLE public.appointments ADD COLUMN address_references TEXT;
    END IF;
END $$;
