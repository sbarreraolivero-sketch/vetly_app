
-- =============================================================
-- FIX: clinic_members RLS Policies (Fixing Infinite Recursion)
-- =============================================================

-- 1. Ensure the function is SECURITY DEFINER (to bypass RLS when checking permissions)
CREATE OR REPLACE FUNCTION public.is_clinic_admin(p_clinic_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.clinic_members 
    WHERE user_id = auth.uid() 
    AND clinic_id = p_clinic_id
    AND role IN ('owner', 'admin')
    AND status = 'active'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Use the function in policies to avoid recursion
DROP POLICY IF EXISTS "Admins and Owners can manage members" ON public.clinic_members;
CREATE POLICY "Admins and Owners can manage members"
  ON public.clinic_members FOR ALL
  USING (public.is_clinic_admin(clinic_id));

-- 3. Update profile policy (this one is direct and safe)
DROP POLICY IF EXISTS "Users can update own profile" ON public.clinic_members;
CREATE POLICY "Users can update own profile"
  ON public.clinic_members FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 4. Robust Select policy using function or direct check
DROP POLICY IF EXISTS "Users can view own memberships" ON public.clinic_members;
CREATE POLICY "Users can view own memberships"
  ON public.clinic_members FOR SELECT
  USING (auth.uid() = user_id OR public.is_clinic_admin(clinic_id));
