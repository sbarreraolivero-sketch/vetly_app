-- =============================================
-- MIGRATION: Multi-Branch Support (Prestige)
-- =============================================

-- 1. RPC: Obtener todas las clínicas del usuario
CREATE OR REPLACE FUNCTION public.get_user_clinics()
RETURNS TABLE (
  clinic_id UUID,
  clinic_name TEXT,
  role user_role,
  status member_status,
  plan TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    cs.id as clinic_id,
    cs.clinic_name,
    cm.role,
    cm.status,
    cs.subscription_plan as plan
  FROM public.clinic_members cm
  JOIN public.clinic_settings cs ON cm.clinic_id = cs.id
  WHERE cm.user_id = auth.uid()
  AND cm.status = 'active'
  ORDER BY cs.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. RPC: Crear nueva sucursal (Solo Prestige)
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
  -- Obtener email del usuario
  v_user_email := auth.jwt()->>'email';

  -- 1. Validar que el usuario tenga al menos una clínica con Plan Prestige (y sea Owner)
  -- O que sea un usuario "Prestige" globalmente (simplificación: verificamos si es owner de alguna prestige)
  SELECT EXISTS (
    SELECT 1
    FROM public.clinic_members cm
    JOIN public.clinic_settings cs ON cm.clinic_id = cs.id
    WHERE cm.user_id = auth.uid()
    AND cm.role = 'owner'
    AND cs.subscription_plan = 'prestige'
    AND cm.status = 'active'
  ) INTO v_has_prestige;

  IF NOT v_has_prestige THEN
     -- Opción: Permitir crear si es la PRIMERA clínica (onboarding)
     -- Pero esta función es "create_branch", asumimos que ya existe una.
     -- Si el usuario no tiene ninguna clínica, permitimos crear (Onboarding inicial)
     IF EXISTS (SELECT 1 FROM public.clinic_members WHERE user_id = auth.uid()) THEN
        RAISE EXCEPTION 'Solo los usuarios con Plan Prestige pueden crear sucursales adicionales.';
     END IF;
  END IF;

  -- 2. Crear la nueva clínica
  INSERT INTO public.clinic_settings (
      clinic_name, 
      subscription_plan,
      max_users
  )
  VALUES (
      p_name, 
      'basic', -- Empieza como basic/trial, luego se puede vincular o upgradear
      2        -- Default max users
  )
  RETURNING id INTO v_new_clinic_id;

  -- 3. Insertar al usuario como Owner
  INSERT INTO public.clinic_members (clinic_id, user_id, email, role, status)
  VALUES (v_new_clinic_id, auth.uid(), v_user_email, 'owner', 'active');

  RETURN v_new_clinic_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
