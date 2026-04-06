-- Migration: ensure_delete_clinic_member_works
-- Description: Ensures the delete_clinic_member function exists and works correctly.
-- This is a safety net - DROP + CREATE to guarantee the correct version is in production.

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
    -- Only allow if user has another active record (e.g., owner trying to delete their duplicate)
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
