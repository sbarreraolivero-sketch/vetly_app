-- Add Finance Columns to Appointments
ALTER TABLE public.appointments 
ADD COLUMN IF NOT EXISTS price NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'partial', 'refunded')),
ADD COLUMN IF NOT EXISTS payment_method TEXT;

-- Create Expenses Table
CREATE TABLE IF NOT EXISTS public.expenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('rent', 'supplies', 'payroll', 'marketing', 'utilities', 'other')),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS for Expenses
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage expenses"
  ON public.expenses FOR ALL
  USING (auth.role() = 'authenticated');

CREATE POLICY "Service role full access to expenses"
  ON public.expenses FOR ALL
  USING (auth.role() = 'service_role');

-- Full Finance Stats RPC
CREATE OR REPLACE FUNCTION public.get_finance_stats(
  p_clinic_id UUID,
  p_start_date TIMESTAMP WITH TIME ZONE,
  p_end_date TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE (
  total_income NUMERIC,
  total_expenses NUMERIC,
  net_profit NUMERIC,
  pending_payments NUMERIC,
  appointments_count INTEGER
) AS $$
DECLARE
  v_income NUMERIC;
  v_expenses NUMERIC;
  v_pending NUMERIC;
  v_count INTEGER;
BEGIN
  -- Calculate Income (Paid or Partial)
  SELECT COALESCE(SUM(price), 0), COUNT(*)
  INTO v_income, v_count
  FROM public.appointments
  WHERE clinic_id = p_clinic_id
    AND appointment_date >= p_start_date
    AND appointment_date <= p_end_date
    AND payment_status IN ('paid', 'partial');

  -- Calculate Expenses
  SELECT COALESCE(SUM(amount), 0)
  INTO v_expenses
  FROM public.expenses
  WHERE clinic_id = p_clinic_id
    AND date >= p_start_date::DATE
    AND date <= p_end_date::DATE;

  -- Calculate Pending
  SELECT COALESCE(SUM(price), 0)
  INTO v_pending
  FROM public.appointments
  WHERE clinic_id = p_clinic_id
    AND appointment_date >= p_start_date
    AND appointment_date <= p_end_date
    AND payment_status = 'pending';

  RETURN QUERY SELECT 
    v_income, 
    v_expenses, 
    (v_income - v_expenses), 
    v_pending,
    v_count;
END;
$$ LANGUAGE plpgsql;
