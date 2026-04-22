
-- =============================================================
-- FIX: get_clinic_professionals RPC TYPE MISMATCH
-- Resolves "cannot change return type of existing function"
-- =============================================================

-- We must drop it first because we are changing the return type of the 'role' column from user_role to TEXT
DROP FUNCTION IF EXISTS public.get_clinic_professionals(uuid);

CREATE OR REPLACE FUNCTION public.get_clinic_professionals(p_clinic_id UUID)
RETURNS TABLE (
    member_id UUID,
    first_name TEXT,
    last_name TEXT,
    email TEXT,
    role TEXT,             -- Changed to TEXT for maximum compatibility
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
        cm.role::TEXT,      -- Cast to TEXT to match return type
        cm.job_title,
        cm.specialty,
        cm.color,
        cm.working_hours
    FROM public.clinic_members cm
    WHERE cm.clinic_id = p_clinic_id
      AND cm.status = 'active'
      AND cm.role::TEXT NOT IN ('receptionist')
    ORDER BY cm.first_name ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
