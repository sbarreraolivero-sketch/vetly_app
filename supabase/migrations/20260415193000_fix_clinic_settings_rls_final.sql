-- Final fix for clinic_settings RLS to allow upsert and correct permissions
DROP POLICY IF EXISTS "Allow Members to update clinic_settings" ON public.clinic_settings;
DROP POLICY IF EXISTS "Allow Admins to insert clinic_settings" ON public.clinic_settings;
DROP POLICY IF EXISTS "Allow Members to read clinic_settings" ON public.clinic_settings;

-- 1. Permissive SELECT for members
CREATE POLICY "Allow Members to read clinic_settings"
  ON public.clinic_settings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.clinic_members 
      WHERE user_id = auth.uid() AND clinic_id = clinic_settings.id 
    ) OR EXISTS (
      SELECT 1 FROM public.user_profiles 
      WHERE id = auth.uid() AND clinic_id = clinic_settings.id
    ) OR (id IN (SELECT clinic_id FROM public.clinic_members WHERE user_id = auth.uid()))
  );

-- 2. Permissive INSERT for onboarding/fallback
CREATE POLICY "Allow Members to insert clinic_settings"
  ON public.clinic_settings FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL 
    AND (
      EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND (clinic_id = id OR clinic_id IS NULL))
      OR EXISTS (SELECT 1 FROM public.clinic_members WHERE user_id = auth.uid() AND clinic_id = id)
    )
  );

-- 3. Permissive UPDATE for admins
CREATE POLICY "Allow Members to update clinic_settings"
  ON public.clinic_settings FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.clinic_members 
      WHERE user_id = auth.uid() 
      AND clinic_id = clinic_settings.id
      AND role::text IN ('owner', 'admin', 'administrador', 'super_admin', 'vet_assistant')
    ) OR EXISTS (
      SELECT 1 FROM public.user_profiles 
      WHERE id = auth.uid() 
      AND clinic_id = clinic_settings.id
      AND role::text IN ('owner', 'admin', 'administrador', 'super_admin')
    )
  );
