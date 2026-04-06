-- Migration: fix_plan_limits_consistency
-- Description: Ensures all clinic_settings.max_users values are consistent 
-- with the standardized plan limits (999999 = unlimited for Prestige).
-- Also updates invite_member_v2 to properly handle unlimited plans.

-- 1. Fix existing clinics: sync max_users based on subscription_plan
UPDATE clinic_settings SET max_users = 999999 WHERE subscription_plan = 'prestige' AND (max_users IS NULL OR max_users < 999999);
UPDATE clinic_settings SET max_users = 5 WHERE subscription_plan = 'radiance' AND (max_users IS NULL OR max_users < 5);
UPDATE clinic_settings SET max_users = 2 WHERE subscription_plan = 'essence' AND (max_users IS NULL OR max_users < 2);

-- 2. Also sync from subscriptions table (source of truth for active plans)
UPDATE clinic_settings cs
SET max_users = CASE 
    WHEN s.plan = 'prestige' THEN 999999
    WHEN s.plan = 'radiance' THEN 5
    WHEN s.plan = 'essence' THEN 2
    ELSE cs.max_users
END
FROM subscriptions s
WHERE s.clinic_id = cs.id
AND s.status IN ('active', 'trial', 'converted', 'freemium');

-- 3. Update invite_member_v2 to properly handle unlimited plans (>= 999)
CREATE OR REPLACE FUNCTION public.invite_member_v2(
  p_clinic_id UUID,
  p_email TEXT,
  p_role user_role,
  p_first_name TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_current_count INTEGER;
  v_max_users INTEGER;
  v_plan TEXT;
  v_new_id UUID;
BEGIN
  -- Verify permissions (only owner/admin)
  IF NOT public.is_clinic_admin(p_clinic_id) THEN
    RAISE EXCEPTION 'Access denied. Only owners/admins can invite members.';
  END IF;

  -- Get limit from clinic_settings
  SELECT max_users, subscription_plan INTO v_max_users, v_plan FROM public.clinic_settings WHERE id = p_clinic_id;

  -- Override from subscriptions table if available (source of truth)
  DECLARE
    v_sub_plan TEXT;
  BEGIN
    SELECT plan INTO v_sub_plan FROM public.subscriptions WHERE clinic_id = p_clinic_id AND status IN ('active', 'trial', 'converted', 'freemium') LIMIT 1;
    IF v_sub_plan IS NOT NULL THEN
      v_plan := v_sub_plan;
      v_max_users := CASE 
        WHEN v_sub_plan = 'prestige' THEN 999999
        WHEN v_sub_plan = 'radiance' THEN 5
        WHEN v_sub_plan = 'essence' THEN 2
        ELSE COALESCE(v_max_users, 2)
      END;
    END IF;
  END;

  -- If max_users >= 999, treat as unlimited (skip count check)
  IF COALESCE(v_max_users, 2) < 999 THEN
    SELECT COUNT(*) INTO v_current_count FROM public.clinic_members WHERE clinic_id = p_clinic_id AND status IN ('active', 'invited');
    IF v_current_count >= v_max_users THEN
      RAISE EXCEPTION 'Plan limit reached. Maximum % users allowed for plan %.', v_max_users, COALESCE(v_plan, 'unknown');
    END IF;
  END IF;

  -- Check for duplicate email in this clinic
  IF EXISTS (SELECT 1 FROM public.clinic_members WHERE clinic_id = p_clinic_id AND email = p_email AND status IN ('active', 'invited')) THEN
    RAISE EXCEPTION 'Este correo ya tiene una invitación pendiente o es miembro activo.';
  END IF;

  -- Insert invitation
  INSERT INTO public.clinic_members (clinic_id, email, role, status, first_name)
  VALUES (p_clinic_id, p_email, p_role, 'invited', p_first_name)
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('id', v_new_id, 'status', 'success');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
