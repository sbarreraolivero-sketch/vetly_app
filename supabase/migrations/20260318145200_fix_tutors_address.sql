
-- =============================================================
-- VETLY AI: FIX TUTORS TABLE SCHEMA
-- Adds missing 'address' column to tutors table.
-- =============================================================

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'tutors' AND column_name = 'address') THEN
        ALTER TABLE public.tutors ADD COLUMN address TEXT;
    END IF;
END $$;
