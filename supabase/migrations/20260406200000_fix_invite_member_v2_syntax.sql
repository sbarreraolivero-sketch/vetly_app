-- Migration: fix_invite_member_v2_syntax
-- Description: Fixes the invite_member_v2 function. The previous version had
-- an invalid nested DECLARE block in PL/pgSQL. This version uses a cleaner
-- approach reading the plan from subscriptions table via a subquery.

-- Also ensures max_users is corrected for existing clinics with prestige plan.
UPDATE public.clinic_settings 
SET max_users = 999999 
WHERE subscription_plan = 'prestige' AND (max_users IS NULL OR max_users < 999);

UPDATE public.clinic_settings cs
SET max_users = 999999
FROM public.subscriptions s
WHERE s.clinic_id = cs.id
  AND s.plan = 'prestige'
  AND s.status IN ('active', 'trial', 'converted', 'freemium')
  AND (cs.max_users IS NULL OR cs.max_users < 999);

UPDATE public.clinic_settings cs
SET max_users = 5
FROM public.subscriptions s
WHERE s.clinic_id = cs.id
  AND s.plan = 'radiance'
  AND s.status IN ('active', 'trial', 'converted', 'freemium')
  AND (cs.max_users IS NULL OR cs.max_users < 5);

-- Drop old function first to avoid signature conflicts
DROP FUNCTION IF EXISTS public.invite_member_v2(UUID, TEXT, user_role, TEXT);

-- Recreate with correct PL/pgSQL syntax (no nested DECLARE blocks)
CREATE OR REPLACE FUNCTION public.invite_member_v2(
  p_clinic_id UUID,
  p_email TEXT,
  p_role user_role,
  p_first_name TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_current_count INTEGER;
  v_max_users     INTEGER;
  v_plan          TEXT;
  v_sub_plan      TEXT;
  v_new_id        UUID;
BEGIN
  -- Verify permissions (only owner/admin)
  IF NOT public.is_clinic_admin(p_clinic_id) THEN
    RAISE EXCEPTION 'Access denied. Only owners/admins can invite members.';
  END IF;

  -- Get max_users and plan from clinic_settings (baseline)
  SELECT max_users, subscription_plan
    INTO v_max_users, v_plan
    FROM public.clinic_settings
   WHERE id = p_clinic_id;

  -- Override plan from subscriptions table (source of truth for active plans)
  SELECT plan INTO v_sub_plan
    FROM public.subscriptions
   WHERE clinic_id = p_clinic_id
     AND status IN ('active', 'trial', 'converted', 'freemium')
   LIMIT 1;

  IF v_sub_plan IS NOT NULL THEN
    v_plan := v_sub_plan;
    -- Re-derive max_users from the authoritative plan name
    v_max_users := CASE
      WHEN v_sub_plan = 'prestige' THEN 999999
      WHEN v_sub_plan = 'radiance' THEN 5
      WHEN v_sub_plan = 'essence'  THEN 2
      ELSE COALESCE(v_max_users, 2)
    END;
  END IF;

  -- Ensure we have a sane fallback
  v_max_users := COALESCE(v_max_users, 2);

  -- Check duplicate email in this clinic before counting
  IF EXISTS (
    SELECT 1 FROM public.clinic_members
     WHERE clinic_id = p_clinic_id
       AND email = p_email
       AND status IN ('active', 'invited')
  ) THEN
    RAISE EXCEPTION 'Este correo ya tiene una invitación pendiente o pertenece a un miembro activo.';
  END IF;

  -- If plan is NOT unlimited (< 999), enforce user count limit
  IF v_max_users < 999 THEN
    SELECT COUNT(*) INTO v_current_count
      FROM public.clinic_members
     WHERE clinic_id = p_clinic_id
       AND status IN ('active', 'invited');

    IF v_current_count >= v_max_users THEN
      RAISE EXCEPTION 'Plan limit reached. Maximum % users allowed for plan %.', v_max_users, COALESCE(v_plan, 'unknown');
    END IF;
  END IF;
  -- If v_max_users >= 999 → unlimited, skip the count check entirely

  -- Insert invitation
  INSERT INTO public.clinic_members (clinic_id, email, role, status, first_name)
  VALUES (p_clinic_id, p_email, p_role, 'invited', p_first_name)
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('id', v_new_id, 'status', 'success');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
