-- Migration: Allow Admins to update clinic settings
-- Description: Updates RLS policy for clinic_settings to include 'admin' role in update permissions.

BEGIN;

-- 1. Drop the existing restrictive policy
DROP POLICY IF EXISTS "Owners can update clinic_settings" ON public.clinic_settings;

-- 2. Create the new inclusive policy
CREATE POLICY "Owners and admins can update clinic_settings"
  ON public.clinic_settings FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.clinic_members 
      WHERE user_id = auth.uid() 
      AND clinic_id = clinic_settings.id 
      AND role IN ('owner', 'admin')
      AND status = 'active'
    )
  );

COMMIT;
