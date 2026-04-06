-- REDEFINIR RPC: Crear nueva sucursal (HEREDAR PRESTIGE)
DROP FUNCTION IF EXISTS public.create_clinic_branch(text, text);

CREATE OR REPLACE FUNCTION public.create_clinic_branch(
  p_name TEXT,
  p_address TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_new_clinic_id UUID;
  v_user_email TEXT;
BEGIN
  -- Obtener email del usuario desde el JWT
  v_user_email := auth.jwt()->>'email';

  -- 1. Validar que sea Owner (solo los dueños crean sucursales)
  IF NOT EXISTS (SELECT 1 FROM public.clinic_members WHERE user_id = auth.uid() AND role = 'owner') THEN
     RAISE EXCEPTION 'Solo los dueños de clínica pueden crear sucursales adicionales.';
  END IF;

  -- 2. Crear la nueva clínica con PLAN PRESTIGE por defecto
  INSERT INTO public.clinic_settings (
      clinic_name, 
      address,
      subscription_plan,
      max_users,
      timezone
  )
  VALUES (
      p_name, 
      p_address,
      'prestige', -- Hereda prestige permanentemente
      -1,         -- Usuarios ilimitados
      'America/Mexico_City' -- Default
  )
  RETURNING id INTO v_new_clinic_id;

  -- 3. Insertar al usuario como Owner de la nueva sucursal
  INSERT INTO public.clinic_members (clinic_id, user_id, email, role, status)
  VALUES (v_new_clinic_id, auth.uid(), v_user_email, 'owner', 'active');

  RETURN v_new_clinic_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
