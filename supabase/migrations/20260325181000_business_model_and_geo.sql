
-- =============================================================
-- VETLY AI: BUSINESS MODEL & GEO-OPTIMIZATION SUPPORT
-- Adds 'business_model' to clinic_settings and geo-coordinates
-- =============================================================

-- 1. Add business_model to clinic_settings
-- Default is 'physical' to preserve existing clinic behavior
ALTER TABLE public.clinic_settings 
ADD COLUMN IF NOT EXISTS business_model TEXT DEFAULT 'physical' 
CHECK (business_model IN ('physical', 'mobile', 'hybrid'));

-- 2. Add coordinates to clinic_settings (Base of Operations)
ALTER TABLE public.clinic_settings 
ADD COLUMN IF NOT EXISTS latitude DECIMAL(9,6),
ADD COLUMN IF NOT EXISTS longitude DECIMAL(9,6);

-- 3. Add coordinates to tutors (Home Address Caching)
ALTER TABLE public.tutors 
ADD COLUMN IF NOT EXISTS latitude DECIMAL(9,6),
ADD COLUMN IF NOT EXISTS longitude DECIMAL(9,6);

-- 4. Add coordinates to appointments (Service Location)
ALTER TABLE public.appointments 
ADD COLUMN IF NOT EXISTS latitude DECIMAL(9,6),
ADD COLUMN IF NOT EXISTS longitude DECIMAL(9,6);

-- 5. Update RLS policies (if any specific ones are needed, but default ones usually cover these columns)
-- No additional specific policies needed for raw columns if generic 'Authenticated' policies exist.
