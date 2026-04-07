-- Migration: update_invite_details_rpc
-- Description: Updates check_pending_invite_details to return first_name and role.

-- DROP first to handle changed return columns (CREATE OR REPLACE doesn't allow changing TABLE columns)
DROP FUNCTION IF EXISTS public.check_pending_invite_details(TEXT, UUID);

CREATE OR REPLACE FUNCTION public.check_pending_invite_details(
  p_email TEXT,
  p_clinic_id UUID DEFAULT NULL
)
RETURNS TABLE (
  valid BOOLEAN,
  clinic_name TEXT,
  first_name TEXT,
  role user_role
) AS $$
DECLARE
  v_clinic_name TEXT;
  v_first_name TEXT;
  v_role user_role;
BEGIN
  SELECT cs.clinic_name, cm.first_name, cm.role 
    INTO v_clinic_name, v_first_name, v_role
  FROM public.clinic_members cm
  JOIN public.clinic_settings cs ON cm.clinic_id = cs.id
  WHERE cm.email = p_email
  AND cm.status = 'invited'
  AND (p_clinic_id IS NULL OR cm.clinic_id = p_clinic_id)
  ORDER BY cm.created_at DESC
  LIMIT 1;

  IF v_clinic_name IS NOT NULL THEN
    RETURN QUERY SELECT TRUE, v_clinic_name, v_first_name, v_role;
  ELSE
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::TEXT, NULL::user_role;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
