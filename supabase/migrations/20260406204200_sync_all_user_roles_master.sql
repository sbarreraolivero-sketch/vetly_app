-- Migration: sync_all_user_roles_final
-- Description: Ensures the user_role enum contains all roles used in the application.

-- 1. Ensure all values exist in the enum (individual statements outside transaction)
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'owner';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'admin';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'professional';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'receptionist';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'vet_assistant';

-- 2. Audit and fix any existing members with missing status or inconsistent roles
-- (Optional safety check)
UPDATE public.clinic_members 
SET status = 'active' 
WHERE status IS NULL;

-- 3. Update helper functions with text-based comparisons (the safest method)

-- is_clinic_admin
CREATE OR REPLACE FUNCTION public.is_clinic_admin(p_clinic_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.clinic_members cm
    WHERE cm.user_id = auth.uid() 
    AND cm.clinic_id = p_clinic_id
    AND cm.role::text IN ('owner', 'admin') -- Safe text comparison
    AND cm.status = 'active'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- delete_clinic_member
CREATE OR REPLACE FUNCTION public.delete_clinic_member(
  p_member_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_clinic_id UUID;
  v_target_role text;
  v_target_user_id UUID;
  v_caller_role text;
  v_is_self BOOLEAN;
BEGIN
  -- Get member details
  SELECT cm.clinic_id, cm.role::text, cm.user_id 
    INTO v_clinic_id, v_target_role, v_target_user_id
    FROM public.clinic_members cm
   WHERE cm.id = p_member_id;

  IF v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'Miembro no encontrado.';
  END IF;

  -- Get caller details
  SELECT cm.role::text INTO v_caller_role
    FROM public.clinic_members cm
   WHERE cm.user_id = auth.uid()
     AND cm.clinic_id = v_clinic_id
     AND cm.status = 'active'
   ORDER BY (CASE WHEN cm.role::text = 'owner' THEN 1 ELSE 2 END)
   LIMIT 1;

  -- Permission verify
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'No tienes permisos para eliminar miembros.';
  END IF;

  -- Protect Owner
  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'No se puede eliminar al propietario de la clínica.';
  END IF;

  -- Self removal handle
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

  -- Do Delete
  DELETE FROM public.clinic_members WHERE id = p_member_id;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
