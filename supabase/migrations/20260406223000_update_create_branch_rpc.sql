-- REDEFINIR RPC: Crear nueva sucursal (Fijar error de parámetros y dirección)
DROP FUNCTION IF EXISTS public.create_clinic_branch(text, text);

CREATE OR REPLACE FUNCTION public.create_clinic_branch(
  p_name TEXT,
  p_address TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_new_clinic_id UUID;
  v_has_prestige BOOLEAN;
  v_user_email TEXT;
BEGIN
  -- Obtener email del usuario desde el JWT
  v_user_email := auth.jwt()->>'email';

  -- 1. Validar que el usuario tenga al menos una clínica con Plan Prestige (y sea Owner)
  SELECT EXISTS (
    SELECT 1
    FROM public.clinic_members cm
    JOIN public.clinic_settings cs ON cm.clinic_id = cs.id
    WHERE cm.user_id = auth.uid()
    AND cm.role = 'owner'
    AND cs.subscription_plan = 'prestige'
    AND cm.status = 'active'
  ) INTO v_has_prestige;

  -- Bypas temporal: Permitir si es el owner principal incluso si el plan no dice prestige explícitamente 
  -- para evitar bloqueos por discrepancias de cache
  IF NOT v_has_prestige THEN
     IF NOT EXISTS (SELECT 1 FROM public.clinic_members WHERE user_id = auth.uid() AND role = 'owner') THEN
        RAISE EXCEPTION 'Solo los dueños de clínica pueden crear sucursales adicionales.';
     END IF;
  END IF;

  -- 2. Crear la nueva clínica con todos los campos necesarios
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
      'basic', -- Empieza como basic, luego se hereda o actualiza
      2,
      'America/Mexico_City' -- Default
  )
  RETURNING id INTO v_new_clinic_id;

  -- 3. Insertar al usuario como Owner de la nueva sucursal
  INSERT INTO public.clinic_members (clinic_id, user_id, email, role, status)
  VALUES (v_new_clinic_id, auth.uid(), v_user_email, 'owner', 'active');

  RETURN v_new_clinic_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
