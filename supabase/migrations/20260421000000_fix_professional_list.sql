-- Migration: Fix professional list to include all active non-receptionist members
-- This ensures Claudia and other admins/owners appear in the appointment professional dropdown.

CREATE OR REPLACE FUNCTION public.get_clinic_professionals(p_clinic_id UUID)
RETURNS TABLE (
    member_id UUID,
    first_name TEXT,
    last_name TEXT,
    email TEXT,
    role public.user_role,
    job_title TEXT,
    specialty TEXT,
    color TEXT,
    working_hours JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        cm.id as member_id,
        cm.first_name,
        cm.last_name,
        cm.email,
        cm.role,
        cm.job_title,
        cm.specialty,
        cm.color,
        cm.working_hours
    FROM public.clinic_members cm
    WHERE cm.clinic_id = p_clinic_id
      AND cm.status = 'active'
      AND cm.role NOT IN ('receptionist')
    ORDER BY cm.first_name ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fix for user limit UI bug (-1 interpreted literally)
UPDATE public.clinic_settings 
SET max_users = 100 
WHERE max_users = -1;
