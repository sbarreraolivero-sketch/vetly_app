-- Migration: add_admin_to_user_role_enum
-- The user_role enum is missing 'admin'. This causes a crash when
-- delete_clinic_member or is_clinic_admin compare against 'admin'.

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_enum 
        JOIN pg_type ON pg_enum.enumtypid = pg_type.oid 
        WHERE pg_type.typname = 'user_role' 
        AND pg_enum.enumlabel = 'admin'
    ) THEN
        ALTER TYPE user_role ADD VALUE 'admin';
    END IF;
END $$;

-- Now recreate the functions that reference 'admin' to ensure they work

-- is_clinic_admin
DROP FUNCTION IF EXISTS public.is_clinic_admin(UUID);
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

-- delete_clinic_member  
DROP FUNCTION IF EXISTS public.delete_clinic_member(UUID);
CREATE FUNCTION public.delete_clinic_member(
  p_member_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_clinic_id UUID;
  v_target_role user_role;
  v_target_user_id UUID;
  v_caller_role user_role;
  v_is_self BOOLEAN;
BEGIN
  -- 1. Get the target member's details
  SELECT cm.clinic_id, cm.role, cm.user_id 
    INTO v_clinic_id, v_target_role, v_target_user_id
    FROM public.clinic_members cm
   WHERE cm.id = p_member_id;

  IF v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'Miembro no encontrado.';
  END IF;

  -- 2. Get the caller's role in this clinic
  SELECT cm.role INTO v_caller_role
    FROM public.clinic_members cm
   WHERE cm.user_id = auth.uid()
     AND cm.clinic_id = v_clinic_id
     AND cm.status = 'active'
   ORDER BY (CASE WHEN cm.role = 'owner' THEN 1 ELSE 2 END)
   LIMIT 1;

  -- 3. Verify caller has permission (must be Owner or Admin)
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'No tienes permisos para eliminar miembros.';
  END IF;

  -- 4. Never delete an Owner record
  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'No se puede eliminar al propietario de la clínica.';
  END IF;

  -- 5. Handle self-deletion (duplicate cleanup)
  v_is_self := (v_target_user_id IS NOT NULL AND v_target_user_id = auth.uid());
  
  IF v_is_self THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.clinic_members cm2
       WHERE cm2.user_id = auth.uid()
         AND cm2.clinic_id = v_clinic_id
         AND cm2.id <> p_member_id
         AND cm2.status = 'active'
    ) THEN
      RAISE EXCEPTION 'No puedes eliminar tu única membresía activa.';
    END IF;
  END IF;

  -- 6. Perform deletion
  DELETE FROM public.clinic_members WHERE id = p_member_id;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
