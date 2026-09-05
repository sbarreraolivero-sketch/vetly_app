-- Las políticas UPDATE de clinic_settings permiten a owner/admin (y hasta
-- vet_assistant) escribir CUALQUIER columna de su clínica. Eso deja columnas
-- de facturación auto-editables desde el navegador (un owner podía ponerse
-- ai_credits_extra_balance = 999999, subscription_plan = 'enterprise',
-- pilot_eligible = true, etc.). Este trigger bloquea el cambio de esas columnas
-- para cualquier request con JWT de usuario (authenticated/anon); solo el
-- service_role (webhooks de pago, RPCs, edge functions) y las migraciones pueden
-- tocarlas. La versión final (con exención de platform admins y search_path fijo)
-- queda en la migración 20260905183950.
CREATE OR REPLACE FUNCTION public.guard_clinic_settings_billing_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF auth.role() IN ('authenticated', 'anon') THEN
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

DROP TRIGGER IF EXISTS trg_guard_clinic_settings_billing ON public.clinic_settings;
CREATE TRIGGER trg_guard_clinic_settings_billing
  BEFORE UPDATE ON public.clinic_settings
  FOR EACH ROW EXECUTE FUNCTION public.guard_clinic_settings_billing_columns();
