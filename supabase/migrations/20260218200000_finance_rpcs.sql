-- Finance RPCs - V4 (CLEAN RESET)
-- First: aggressively drop ALL existing versions

-- Drop with exact signatures from V1 (original run)
DROP FUNCTION IF EXISTS public.create_clinic_expense(UUID, TEXT, NUMERIC, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.get_clinic_expenses_secure(UUID);
DROP FUNCTION IF EXISTS public.get_clinic_transactions_secure(UUID);
DROP FUNCTION IF EXISTS public.update_appointment_payment_status(UUID, TEXT);

-- Also try dropping without args in case there are other overloads
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN 
    SELECT oid::regprocedure AS func_sig
    FROM pg_proc
    WHERE proname = 'create_clinic_expense'
      AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.func_sig || ' CASCADE';
  END LOOP;
  
  FOR r IN 
    SELECT oid::regprocedure AS func_sig
    FROM pg_proc
    WHERE proname = 'get_clinic_expenses_secure'
      AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.func_sig || ' CASCADE';
  END LOOP;
  
  FOR r IN 
    SELECT oid::regprocedure AS func_sig
    FROM pg_proc
    WHERE proname = 'get_clinic_transactions_secure'
      AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.func_sig || ' CASCADE';
  END LOOP;
  
  FOR r IN 
    SELECT oid::regprocedure AS func_sig
    FROM pg_proc
    WHERE proname = 'update_appointment_payment_status'
      AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.func_sig || ' CASCADE';
  END LOOP;
END $$;


-- =============================================
-- 1. Create Expense
-- =============================================
CREATE OR REPLACE FUNCTION public.create_clinic_expense(
  p_clinic_id UUID,
  p_description TEXT,
  p_amount NUMERIC,
  p_category TEXT,
  p_date TEXT
)
RETURNS SETOF public.expenses AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.clinic_members
    WHERE user_id = auth.uid()
      AND clinic_id = p_clinic_id
      AND status = 'active'
      AND role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'Access denied.';
  END IF;

  RETURN QUERY
  INSERT INTO public.expenses (clinic_id, description, amount, category, date)
  VALUES (p_clinic_id, p_description, p_amount, p_category, p_date::DATE)
  RETURNING *;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =============================================
-- 2. Get Expenses
-- =============================================
CREATE OR REPLACE FUNCTION public.get_clinic_expenses_secure(
  p_clinic_id UUID
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
  ORDER BY date DESC, created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =============================================
-- 3. Get Transactions
-- NOTE: appointments table does NOT have patient_id
-- It uses patient_name and phone_number directly
-- =============================================
CREATE OR REPLACE FUNCTION public.get_clinic_transactions_secure(
  p_clinic_id UUID
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
  ORDER BY a.appointment_date DESC
  LIMIT 100;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =============================================
-- 4. Update Payment Status
-- =============================================
CREATE OR REPLACE FUNCTION public.update_appointment_payment_status(
  p_appointment_id UUID,
  p_status TEXT
)
RETURNS SETOF public.appointments AS $$
DECLARE
  v_clinic_id UUID;
BEGIN
  SELECT clinic_id INTO v_clinic_id
  FROM public.appointments
  WHERE id = p_appointment_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.clinic_members
    WHERE user_id = auth.uid()
      AND clinic_id = v_clinic_id
      AND status = 'active'
      AND role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'Access denied.';
  END IF;

  RETURN QUERY
  UPDATE public.appointments
  SET payment_status = p_status
  WHERE id = p_appointment_id
  RETURNING *;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
