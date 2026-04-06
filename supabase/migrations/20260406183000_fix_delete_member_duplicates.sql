-- Migration: fix_delete_member_duplicates
-- Description: Updates RPC to allow deleting a clinic member even if it matches the current user, 
-- AS LONG AS the user remains in the clinic with at least one other active record (e.g. Owner).
-- This handles the common scenario where an invitation and registration create duplicate records.

CREATE OR REPLACE FUNCTION public.delete_clinic_member(
  p_member_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_clinic_id UUID;
  v_target_role user_role;
  v_target_user_id UUID;
  v_user_role user_role;
  v_is_self BOOLEAN;
BEGIN
  -- 1. Get the target member's details
  SELECT clinic_id, role, user_id INTO v_clinic_id, v_target_role, v_target_user_id
  FROM public.clinic_members
  WHERE id = p_member_id;

  IF v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  -- 2. Get the executing user's role in this clinic (Source of permission)
  SELECT role INTO v_user_role
  FROM public.clinic_members
  WHERE user_id = auth.uid()
  AND clinic_id = v_clinic_id
  AND status = 'active'
  ORDER BY (CASE WHEN role = 'owner' THEN 1 ELSE 2 END) -- Prefer owner role for permission check
  LIMIT 1;

  -- 3. Verify permissions (Owner or Admin)
  IF v_user_role IS NULL OR v_user_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Access denied. You do not have permission to delete members in this clinic.';
  END IF;

  -- 4. Double check the target is not 'owner'
  -- Even if it is a duplicate, we never delete a record marked as 'owner' to protect the clinic root.
  IF v_target_role = 'owner' THEN
     RAISE EXCEPTION 'Cannot delete an Owner record. Transfer ownership or delete administrative duplicates instead.';
  END IF;
  
  -- 5. Handle "Deleting Yourself" logic
  v_is_self := (v_target_user_id = auth.uid());
  
  IF v_is_self THEN
      -- Check if there's AT LEAST one OTHER active record for this user in this clinic
      IF NOT EXISTS (
          SELECT 1 FROM public.clinic_members 
          WHERE user_id = auth.uid() 
          AND clinic_id = v_clinic_id 
          AND id <> p_member_id
          AND status = 'active'
      ) THEN
          RAISE EXCEPTION 'Cannot delete your only active membership in this clinic. Leave the clinic instead.';
      END IF;
      
      -- If we reach here, it's a duplicate of ourselves (e.g. an Admin record for the Owner)
  END IF;

  -- 6. Perform deletion
  DELETE FROM public.clinic_members
  WHERE id = p_member_id;

  RETURN jsonb_build_object('success', true, 'is_duplicate_cleanup', v_is_self);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
