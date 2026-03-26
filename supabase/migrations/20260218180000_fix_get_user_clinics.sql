-- Migration: fix_get_user_clinics_address
-- Description: Updates get_user_clinics RPC to correctly return the address from clinic_settings.

CREATE OR REPLACE FUNCTION public.get_user_clinics()
RETURNS TABLE (
  clinic_id UUID,
  clinic_name TEXT,
  role user_role,
  status member_status,
  plan TEXT,
  address TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    cs.id as clinic_id,
    cs.clinic_name,
    cm.role,
    cm.status,
    cs.subscription_plan as plan,
    COALESCE(cs.clinic_address, cs.address, '') as address -- Handle both column names just in case, prioritize clinic_address
  FROM public.clinic_members cm
  JOIN public.clinic_settings cs ON cm.clinic_id = cs.id
  WHERE cm.user_id = auth.uid()
  AND cm.status = 'active'
  ORDER BY cs.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
