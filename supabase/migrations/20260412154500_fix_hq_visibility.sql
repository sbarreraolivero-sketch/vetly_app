-- Migration: Fix HQ Visibility for Global Admins
-- Description: Updates RLS policies for critical tables to allow global platform admins access.

BEGIN;

-- 1. Create/Update a helper function for platform admin check
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN AS $$
BEGIN
  -- Returns true if the user is in the platform_admins table
  RETURN EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Update existing helper functions to include platform admin check
-- This automatically fixes many policies that use these helpers

-- Fix is_clinic_member
CREATE OR REPLACE FUNCTION public.is_clinic_member(p_clinic_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  -- Check in platform_admins (Global Access)
  IF public.is_platform_admin() THEN
    RETURN TRUE;
  END IF;

  -- Check in clinic_members
  RETURN EXISTS (
    SELECT 1 FROM public.clinic_members 
    WHERE user_id = auth.uid() 
    AND clinic_id = p_clinic_id 
    AND status = 'active'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fix is_clinic_admin (centralized version from 20260407142400)
CREATE OR REPLACE FUNCTION public.is_clinic_admin(p_clinic_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  -- Check in platform_admins (Global Access)
  IF public.is_platform_admin() THEN
    RETURN TRUE;
  END IF;

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

-- 3. Update table-specific policies that don't rely solely on helpers

-- A) clinic_settings SELECT policy
DROP POLICY IF EXISTS "Allow Members to read clinic_settings" ON public.clinic_settings;
DROP POLICY IF EXISTS "Members can read clinic_settings" ON public.clinic_settings;
DROP POLICY IF EXISTS "Allow Members and HQ Admins to read clinic_settings" ON public.clinic_settings;

CREATE POLICY "Allow Members and HQ Admins to read clinic_settings"
  ON public.clinic_settings FOR SELECT
  USING (
    public.is_clinic_member(id)
    OR 
    EXISTS (
      SELECT 1 FROM public.user_profiles 
      WHERE id = auth.uid() 
      AND clinic_id = clinic_settings.id
    )
    OR
    public.is_platform_admin()
  );

-- B) clinic_members SELECT policy (Critical for joins in HQ)
DROP POLICY IF EXISTS "Owners can view clinic members" ON public.clinic_members;
DROP POLICY IF EXISTS "Allow members to read clinic_members" ON public.clinic_members;
DROP POLICY IF EXISTS "Allow members and HQ Admins to read clinic_members" ON public.clinic_members;

CREATE POLICY "Allow members and HQ Admins to read clinic_members"
  ON public.clinic_members FOR SELECT
  USING (
    clinic_id IN (SELECT clinic_id FROM public.clinic_members WHERE user_id = auth.uid())
    OR
    public.is_platform_admin()
  );

-- C) subscriptions SELECT policy
DROP POLICY IF EXISTS "Allow members to read subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "Allow members and HQ Admins to read subscriptions" ON public.subscriptions;

CREATE POLICY "Allow members and HQ Admins to read subscriptions"
  ON public.subscriptions FOR SELECT
  USING (
    clinic_id IN (SELECT clinic_id FROM public.clinic_members WHERE user_id = auth.uid())
    OR
    public.is_platform_admin()
  );

-- D) Ensure CRM tables also have the platform admin check (just in case they were restricted)
DROP POLICY IF EXISTS "Allow all for authenticated users on crm_prospects" ON public.crm_prospects;
CREATE POLICY "Allow members and HQ Admins on crm_prospects" 
  ON public.crm_prospects FOR ALL 
  USING (auth.role() = 'authenticated' OR public.is_platform_admin());

COMMIT;
