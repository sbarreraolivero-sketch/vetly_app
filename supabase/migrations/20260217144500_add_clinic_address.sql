-- Add address column to clinic_settings
ALTER TABLE public.clinic_settings
ADD COLUMN IF NOT EXISTS address TEXT;

-- Update get_user_clinics RPC to return address
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
    cs.address
  FROM public.clinic_members cm
  JOIN public.clinic_settings cs ON cm.clinic_id = cs.id
  WHERE cm.user_id = auth.uid()
  AND cm.status = 'active'
  ORDER BY cs.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
