-- 1. search_path fijo en el trigger de guard (advisor: function_search_path_mutable)
CREATE OR REPLACE FUNCTION public.guard_clinic_settings_billing_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.role() IN ('authenticated', 'anon') AND NOT public.is_platform_admin() THEN
    IF NEW.pilot_eligible            IS DISTINCT FROM OLD.pilot_eligible
       OR NEW.pilot_activated_at     IS DISTINCT FROM OLD.pilot_activated_at
       OR NEW.subscription_plan      IS DISTINCT FROM OLD.subscription_plan
       OR NEW.ai_credits_monthly_limit   IS DISTINCT FROM OLD.ai_credits_monthly_limit
       OR NEW.ai_credits_extra_balance   IS DISTINCT FROM OLD.ai_credits_extra_balance
       OR NEW.ai_credits_extra_4o        IS DISTINCT FROM OLD.ai_credits_extra_4o
       OR NEW.ai_credits_unlimited       IS DISTINCT FROM OLD.ai_credits_unlimited
       OR NEW.ai_credits_extra_expires_at IS DISTINCT FROM OLD.ai_credits_extra_expires_at
       OR NEW.trial_end_date        IS DISTINCT FROM OLD.trial_end_date
       OR NEW.trial_start_date      IS DISTINCT FROM OLD.trial_start_date
       OR NEW.trial_status          IS DISTINCT FROM OLD.trial_status
       OR NEW.activation_status     IS DISTINCT FROM OLD.activation_status
    THEN
      RAISE EXCEPTION 'No autorizado: estas columnas de facturación solo las modifica el sistema.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 2. RLS en la tabla de respaldo de sesión 99 (advisor ERROR: rls_disabled_in_public).
ALTER TABLE IF EXISTS public.requires_human_backup_20260903 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS requires_human_backup_service_role ON public.requires_human_backup_20260903;
CREATE POLICY requires_human_backup_service_role ON public.requires_human_backup_20260903
  FOR ALL TO service_role USING (true) WITH CHECK (true);
