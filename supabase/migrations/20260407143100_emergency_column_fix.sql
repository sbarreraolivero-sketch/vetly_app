-- EMERGENCY FIX: ADD MISSING COLUMNS TO CLINIC_SETTINGS
-- This fix ensures the columns 'ai_auto_respond' and 'ai_active_model' exist in the database.
-- Run this in the SQL Editor of your Supabase dashboard.

-- 1. Ensure 'ai_auto_respond' exists
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clinic_settings' AND column_name='ai_auto_respond') THEN
    ALTER TABLE public.clinic_settings ADD COLUMN ai_auto_respond BOOLEAN DEFAULT true;
    RAISE NOTICE 'Added column ai_auto_respond';
  END IF;
END $$;

-- 2. Ensure 'ai_active_model' exists
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clinic_settings' AND column_name='ai_active_model') THEN
    ALTER TABLE public.clinic_settings ADD COLUMN ai_active_model TEXT DEFAULT '4o';
    RAISE NOTICE 'Added column ai_active_model';
  END IF;
END $$;

-- 3. Ensure 'ai_active_model' is a valid type (it might have been added as something else)
-- If it already exists, make sure it is not NULL and has a default
ALTER TABLE public.clinic_settings ALTER COLUMN ai_active_model SET DEFAULT '4o';
UPDATE public.clinic_settings SET ai_active_model = '4o' WHERE ai_active_model IS NULL;

-- 4. Reload PostgREST schema cache to ensure the API sees the new columns
NOTIFY pgrst, 'reload schema';

-- 5. Re-apply the permissions fix I sent previously (making it extra robust)

-- Ensure all role variations are in the enum
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

-- Update/Create the helper function
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

-- Re-apply RLS Update Policy
DROP POLICY IF EXISTS "Allow Admins to update clinic_settings" ON public.clinic_settings;
DROP POLICY IF EXISTS "Owners and Admins can update clinic_settings" ON public.clinic_settings;
DROP POLICY IF EXISTS "Owners can update clinic_settings" ON public.clinic_settings;
DROP POLICY IF EXISTS "Authenticated users can update clinic_settings" ON public.clinic_settings;
DROP POLICY IF EXISTS "Members can update clinic_settings" ON public.clinic_settings;

CREATE POLICY "Allow Admins to update clinic_settings"
  ON public.clinic_settings FOR UPDATE
  USING (public.is_clinic_admin(id))
  WITH CHECK (public.is_clinic_admin(id));

-- Re-apply RLS Select Policy
DROP POLICY IF EXISTS "Allow Members to read clinic_settings" ON public.clinic_settings;
DROP POLICY IF EXISTS "Members can read clinic_settings" ON public.clinic_settings;
DROP POLICY IF EXISTS "Authenticated users can read clinic_settings" ON public.clinic_settings;

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
