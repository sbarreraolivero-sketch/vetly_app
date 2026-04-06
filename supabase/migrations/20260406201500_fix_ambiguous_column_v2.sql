-- Migration: fix_ambiguous_column_helper_functions_v2
-- Must DROP then CREATE because PostgreSQL doesn't allow renaming params via CREATE OR REPLACE.

-- Drop old functions (cascade will handle dependent objects)
DROP FUNCTION IF EXISTS public.is_clinic_member(UUID);
DROP FUNCTION IF EXISTS public.is_clinic_admin(UUID);

-- Recreate is_clinic_member with unambiguous parameter name
CREATE FUNCTION public.is_clinic_member(p_clinic_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.clinic_members cm
    WHERE cm.user_id = auth.uid() 
    AND cm.clinic_id = p_clinic_id
    AND cm.status = 'active'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate is_clinic_admin with unambiguous parameter name
CREATE FUNCTION public.is_clinic_admin(p_clinic_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.clinic_members cm
    WHERE cm.user_id = auth.uid() 
    AND cm.clinic_id = p_clinic_id
    AND cm.role IN ('owner', 'admin')
    AND cm.status = 'active'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
