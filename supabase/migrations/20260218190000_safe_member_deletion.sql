-- Migration: safe_member_deletion
-- Description: Adds an RPC to safely delete clinic members, verifying ownership permissions on the server side to avoid RLS complexity.

CREATE OR REPLACE FUNCTION public.delete_clinic_member(
  p_member_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_clinic_id UUID;
  v_target_role user_role;
BEGIN
  -- Get the target member's clinic and role
  SELECT clinic_id, role INTO v_clinic_id, v_target_role
  FROM public.clinic_members
  WHERE id = p_member_id;

  IF v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  -- Verify that the executing user is an ADMIN/OWNER of that clinic
  -- We use the helper function exists_clinic_admin or similar logic
  IF NOT EXISTS (
    SELECT 1 FROM public.clinic_members
    WHERE user_id = auth.uid()
    AND clinic_id = v_clinic_id
    AND role IN ('owner', 'admin') -- Allow admins to delete too, or restrict to owner if desired
    AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Access denied. You do not have permission to delete members in this clinic.';
  END IF;

  -- Prevent deleting the Owner (if the target is an owner)
  -- Or prevent deleting yourself if you are the last owner (optional safety)
  IF v_target_role = 'owner' THEN
     RAISE EXCEPTION 'Cannot delete an Owner. Transfer ownership first.';
  END IF;

  -- Perform deletion
  DELETE FROM public.clinic_members
  WHERE id = p_member_id;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
