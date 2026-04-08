-- Migration: Add AI description column to services table
-- Date: 2026-04-06

-- 1. Add ai_description to clinic_services
ALTER TABLE public.clinic_services 
ADD COLUMN IF NOT EXISTS ai_description text;

-- 2. Update secure fetch RPC to include the new field
DROP FUNCTION IF EXISTS public.get_clinic_services_secure(uuid);

CREATE OR REPLACE FUNCTION public.get_clinic_services_secure(p_clinic_id uuid)
RETURNS TABLE (
    id uuid,
    name text,
    duration integer,
    price numeric,
    upselling_enabled boolean,
    upselling_days_after integer,
    upselling_message text,
    ai_description text  -- NEW FIELD
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY
    SELECT 
        s.id, s.name, s.duration, s.price, 
        s.upselling_enabled, s.upselling_days_after, s.upselling_message,
        s.ai_description  -- NEW FIELD
    FROM public.clinic_services s
    WHERE s.clinic_id = p_clinic_id;
END;
$$;
