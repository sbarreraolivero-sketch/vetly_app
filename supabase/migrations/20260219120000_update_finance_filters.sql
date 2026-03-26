-- RPC Updates for Date Filtering
-- Recreates get_clinic_expenses_secure and get_clinic_transactions_secure with date range support

-- 1. Drop old functions (ensure cleanup)
DROP FUNCTION IF EXISTS public.get_clinic_expenses_secure(UUID);
DROP FUNCTION IF EXISTS public.get_clinic_transactions_secure(UUID);

-- 2. Recreate get_clinic_expenses_secure with date range
CREATE OR REPLACE FUNCTION public.get_clinic_expenses_secure(
  p_clinic_id UUID,
  p_start_date TIMESTAMP WITH TIME ZONE,
  p_end_date TIMESTAMP WITH TIME ZONE
)
RETURNS SETOF public.expenses AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.clinic_members
    WHERE user_id = auth.uid()
      AND clinic_id = p_clinic_id
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Access denied.';
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.expenses
  WHERE clinic_id = p_clinic_id
    AND date >= p_start_date::DATE
    AND date <= p_end_date::DATE
  ORDER BY date DESC, created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. Recreate get_clinic_transactions_secure with date range
CREATE OR REPLACE FUNCTION public.get_clinic_transactions_secure(
  p_clinic_id UUID,
  p_start_date TIMESTAMP WITH TIME ZONE,
  p_end_date TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE (
  id UUID,
  appointment_date TIMESTAMPTZ,
  patient_name TEXT,
  service TEXT,
  price NUMERIC,
  payment_status TEXT,
  payment_method TEXT
) AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.clinic_members
    WHERE user_id = auth.uid()
      AND clinic_id = p_clinic_id
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Access denied.';
  END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.appointment_date,
    a.patient_name,
    a.service,
    a.price,
    a.payment_status,
    a.payment_method
  FROM public.appointments a
  WHERE a.clinic_id = p_clinic_id
    AND a.appointment_date >= p_start_date
    AND a.appointment_date <= p_end_date
  ORDER BY a.appointment_date DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
