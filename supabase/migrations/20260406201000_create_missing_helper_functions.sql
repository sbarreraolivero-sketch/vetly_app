-- Migration: create_missing_helper_functions
-- Description: Creates is_clinic_admin and is_clinic_member helper functions
-- that are required by invite_member_v2 and RLS policies.
-- These were defined in an earlier migration that was never applied to production.

-- Helper: Check if current user is a member of clinic X
CREATE OR REPLACE FUNCTION public.is_clinic_member(clinic_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.clinic_members 
    WHERE user_id = auth.uid() 
    AND clinic_id = $1 
    AND status = 'active'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper: Check if current user is Owner or Admin of clinic X
CREATE OR REPLACE FUNCTION public.is_clinic_admin(clinic_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.clinic_members 
    WHERE user_id = auth.uid() 
    AND clinic_id = $1 
    AND role IN ('owner', 'admin')
    AND status = 'active'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
