-- Migration: invite_system_improvements (Revised)
-- Description: Adds RPC to check invite details securely and a trigger to link new users to ALL their pending invited member profiles.

-- 1. RPC to check pending invite and return CLINIC NAME (Publicly accessible for valid emails)
CREATE OR REPLACE FUNCTION public.check_pending_invite_details(
  p_email TEXT,
  p_clinic_id UUID DEFAULT NULL
)
RETURNS TABLE (
  valid BOOLEAN,
  clinic_name TEXT
) AS $$
DECLARE
  v_clinic_name TEXT;
BEGIN
  -- Search for at least one pending invite
  SELECT cs.clinic_name INTO v_clinic_name
  FROM public.clinic_members cm
  JOIN public.clinic_settings cs ON cm.clinic_id = cs.id
  WHERE cm.email = p_email
  AND cm.status = 'invited'
  AND (p_clinic_id IS NULL OR cm.clinic_id = p_clinic_id)
  LIMIT 1;

  IF v_clinic_name IS NOT NULL THEN
    RETURN QUERY SELECT TRUE, v_clinic_name;
  ELSE
    RETURN QUERY SELECT FALSE, NULL::TEXT;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. Trigger function to link user to ALL pending invites
CREATE OR REPLACE FUNCTION public.handle_invite_linking()
RETURNS TRIGGER AS $$
DECLARE
  v_job_title TEXT;
  v_full_name TEXT;
  v_first_name TEXT;
  v_last_name TEXT;
BEGIN
  -- Extract metadata
  v_job_title := NEW.raw_user_meta_data->>'job_title';
  v_full_name := NEW.raw_user_meta_data->>'full_name';
  
  -- Parse names only if full_name is present
  IF v_full_name IS NOT NULL THEN
    v_first_name := split_part(v_full_name, ' ', 1);
    v_last_name := substring(v_full_name from position(' ' in v_full_name) + 1);
  END IF;

  -- Update ALL matching pending invites for this email
  UPDATE public.clinic_members
  SET 
    user_id = NEW.id,
    status = 'active',
    -- Only update these fields if they are null in the existing record OR if we want to overwrite from registration
    -- Usually registration data is fresher for the USER profile, but clinic data might be specific.
    -- Let's prioritize registration data if provided, but respect existing if not.
    job_title = COALESCE(v_job_title, job_title), 
    first_name = COALESCE(v_first_name, first_name),
    last_name = COALESCE(v_last_name, last_name),
    updated_at = NOW()
  WHERE email = NEW.email
  AND status = 'invited';

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists
DROP TRIGGER IF EXISTS on_auth_user_created_link_invite ON auth.users;

-- Create Trigger (AFTER INSERT so NEW.id is available)
CREATE TRIGGER on_auth_user_created_link_invite
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_invite_linking();
