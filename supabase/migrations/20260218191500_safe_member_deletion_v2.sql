-- Migration: safe_member_deletion_v2
-- Description: Updates RPC to safely delete clinic members, verifying ownership permissions on the server side.
-- RELAXED CHECK: Uses simple select instead of complex EXISTS to be safer.

CREATE OR REPLACE FUNCTION public.delete_clinic_member(
  p_member_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_clinic_id UUID;
  v_target_role user_role;
  v_user_role user_role;
BEGIN
  -- 1. Get the target member's clinic and role
  SELECT clinic_id, role INTO v_clinic_id, v_target_role
  FROM public.clinic_members
  WHERE id = p_member_id;

  IF v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  -- 2. Get the executing user's role in this clinic
  SELECT role INTO v_user_role
  FROM public.clinic_members
  WHERE user_id = auth.uid()
  AND clinic_id = v_clinic_id
  AND status = 'active'
  LIMIT 1;

  -- 3. Verify permissions (Owner or Admin)
  IF v_user_role IS NULL OR v_user_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Access denied. You do not have permission to delete members in this clinic.';
  END IF;

  -- 4. Prevent deleting the Owner (if the target is an owner)
  IF v_target_role = 'owner' THEN
     RAISE EXCEPTION 'Cannot delete an Owner. Transfer ownership first.';
  END IF;
  
  -- 5. Prevent deleting yourself
  IF EXISTS (SELECT 1 FROM public.clinic_members WHERE id = p_member_id AND user_id = auth.uid()) THEN
      RAISE EXCEPTION 'Cannot delete yourself. Leave the clinic instead.';
  END IF;

  -- 6. Perform deletion
  DELETE FROM public.clinic_members
  WHERE id = p_member_id;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
