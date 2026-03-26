-- 1. Create function to increment/decrement sub count
CREATE OR REPLACE FUNCTION update_subscription_appointments_used()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.subscriptions
    SET monthly_appointments_used = monthly_appointments_used + 1
    WHERE clinic_id = NEW.clinic_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.subscriptions
    SET monthly_appointments_used = GREATEST(0, monthly_appointments_used - 1)
    WHERE clinic_id = OLD.clinic_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Create trigger on appointments
DROP TRIGGER IF EXISTS trg_update_subscription_usage ON public.appointments;
CREATE TRIGGER trg_update_subscription_usage
AFTER INSERT OR DELETE ON public.appointments
FOR EACH ROW
EXECUTE FUNCTION update_subscription_appointments_used();

-- 3. Backfill existing appointments count for current month
UPDATE public.subscriptions s
SET monthly_appointments_used = (
  SELECT COUNT(*)
  FROM public.appointments a
  WHERE a.clinic_id = s.clinic_id
  AND a.created_at >= date_trunc('month', CURRENT_DATE)
);
