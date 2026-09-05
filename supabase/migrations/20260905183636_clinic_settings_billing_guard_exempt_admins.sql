-- El guard no debe bloquear a los platform admins (usan el panel de HQ, ej.
-- AdminCalendar.tsx setea activation_status/trial_* al activar una cuenta a mano).
CREATE OR REPLACE FUNCTION public.guard_clinic_settings_billing_columns()
RETURNS trigger
LANGUAGE plpgsql
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
