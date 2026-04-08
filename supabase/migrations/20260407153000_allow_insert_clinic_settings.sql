-- Permitir INSERT en clinic_settings para administradores
-- Esto asegura que si el registro no existe, el primer guardado pueda crearlo.

DROP POLICY IF EXISTS "Allow Admins to insert clinic_settings" ON public.clinic_settings;

CREATE POLICY "Allow Admins to insert clinic_settings"
  ON public.clinic_settings FOR INSERT
  WITH CHECK (
    -- Es admin de la clínica (si el ID ya existe)
    public.is_clinic_admin(id) 
    OR 
    -- O es un dueño/admin creando su propia configuración inicial
    EXISTS (
      SELECT 1 FROM public.user_profiles 
      WHERE id = auth.uid() 
      AND clinic_id = clinic_settings.id
      AND role::text IN ('owner', 'admin', 'administrador', 'super_admin')
    )
  );
