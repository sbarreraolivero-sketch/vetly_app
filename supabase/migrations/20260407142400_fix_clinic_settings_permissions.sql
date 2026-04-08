-- DEFINITIVE FIX FOR CLINIC SETTINGS PERMISSIONS
-- This adds 'administrador' to the role enum and updates the RLS policy to be inclusive and robust via a helper function.

-- 1. Ensure all role variations are in the enum
DO $$ 
BEGIN
  BEGIN
    ALTER TYPE public.user_role ADD VALUE 'administrador';
  EXCEPTION
    WHEN duplicate_object THEN null;
  END;
  BEGIN
    ALTER TYPE public.user_role ADD VALUE 'admin';
  EXCEPTION
    WHEN duplicate_object THEN null;
  END;
  BEGIN
    ALTER TYPE public.user_role ADD VALUE 'super_admin';
  EXCEPTION
    WHEN duplicate_object THEN null;
  END;
END $$;

-- 2. Update/Create the helper function to be the central authority for admin status
-- This function checks BOTH clinic_members and user_profiles for maximum resilience
CREATE OR REPLACE FUNCTION public.is_clinic_admin(p_clinic_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  -- Check in clinic_members (primary source)
  IF EXISTS (
    SELECT 1 FROM public.clinic_members cm
    WHERE cm.user_id = v_user_id 
    AND cm.clinic_id = p_clinic_id
    AND cm.role::text IN ('owner', 'admin', 'administrador', 'super_admin', 'vet_assistant')
    AND cm.status = 'active'
  ) THEN
    RETURN TRUE;
  END IF;

  -- Fallback check in user_profiles (secondary source)
  IF EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = v_user_id
    AND up.clinic_id = p_clinic_id
    AND up.role::text IN ('owner', 'admin', 'administrador', 'super_admin')
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Replace the clinic_settings UPDATE policy to use the helper function
-- We drop all existing update policies first to avoid conflicts
DROP POLICY IF EXISTS "Owners and Admins can update clinic_settings" ON public.clinic_settings;
DROP POLICY IF EXISTS "Owners can update clinic_settings" ON public.clinic_settings;
DROP POLICY IF EXISTS "Authenticated users can update clinic_settings" ON public.clinic_settings;
DROP POLICY IF EXISTS "Members can update clinic_settings" ON public.clinic_settings;

DROP POLICY IF EXISTS "Allow Members to update clinic_settings" ON public.clinic_settings;
CREATE POLICY "Allow Members to update clinic_settings"
  ON public.clinic_settings FOR UPDATE
  USING (public.is_clinic_admin(id))
  WITH CHECK (public.is_clinic_admin(id));

-- 4. Ensure SELECT policy also allows these roles
DROP POLICY IF EXISTS "Members can read clinic_settings" ON public.clinic_settings;
DROP POLICY IF EXISTS "Authenticated users can read clinic_settings" ON public.clinic_settings;

DROP POLICY IF EXISTS "Allow Members to read clinic_settings" ON public.clinic_settings;
CREATE POLICY "Allow Members to read clinic_settings"
  ON public.clinic_settings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.clinic_members 
      WHERE user_id = auth.uid() 
      AND clinic_id = clinic_settings.id 
      AND status = 'active'
    )
    OR 
    EXISTS (
      SELECT 1 FROM public.user_profiles 
      WHERE id = auth.uid() 
      AND clinic_id = clinic_settings.id
    )
  );

-- 5. Fix legacy roles in clinic_members if any
-- This converts anyone with 'administrador' to 'admin' to standardize, but the policy above handles both just in case.
UPDATE public.clinic_members 
SET role = 'admin'::public.user_role
WHERE role::text = 'administrador';
