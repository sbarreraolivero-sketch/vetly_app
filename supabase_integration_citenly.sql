-- 1. REGLAS DE COMPORTAMIENTO IA Y PERSONALIDAD
ALTER TABLE public.clinic_settings 
  ADD COLUMN IF NOT EXISTS ai_personality TEXT,
  ADD COLUMN IF NOT EXISTS ai_behavior_rules TEXT;

-- 2. REGISTRO DE RECORDATORIOS (REMINDER LOGS)
CREATE TABLE IF NOT EXISTS public.reminder_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
    appointment_id UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
    type TEXT NOT NULL, -- '24h', '2h', '1h'
    phone_number TEXT NOT NULL,
    status TEXT NOT NULL, -- 'sent', 'failed'
    error_message TEXT,
    sent_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reminder_logs_clinic_id ON public.reminder_logs(clinic_id);
CREATE INDEX IF NOT EXISTS idx_reminder_logs_appointment_id ON public.reminder_logs(appointment_id);
CREATE INDEX IF NOT EXISTS idx_reminder_logs_created_at ON public.reminder_logs(created_at);

ALTER TABLE public.reminder_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clinics can view their own reminder logs" ON public.reminder_logs;
CREATE POLICY "Clinics can view their own reminder logs"
ON public.reminder_logs FOR SELECT
USING (clinic_id IN (
    SELECT clinic_id FROM public.user_profiles WHERE id = auth.uid()
));

GRANT ALL ON public.reminder_logs TO authenticated;
GRANT ALL ON public.reminder_logs TO service_role;

-- 3. GESTIÓN FINANCIERA MANUAL (OTROS INGRESOS)
CREATE TABLE IF NOT EXISTS public.incomes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('service', 'product', 'adjustment', 'other')),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  tutor_id UUID REFERENCES public.tutors(id) ON DELETE SET NULL,
  services JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migración segura si la tabla ya existía
ALTER TABLE public.incomes
ADD COLUMN IF NOT EXISTS tutor_id UUID REFERENCES public.tutors(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS services JSONB DEFAULT '[]'::jsonb;

ALTER TABLE public.incomes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can manage incomes" ON public.incomes;
CREATE POLICY "Authenticated users can manage incomes"
  ON public.incomes FOR ALL
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Service role full access to incomes" ON public.incomes;
CREATE POLICY "Service role full access to incomes"
  ON public.incomes FOR ALL
  USING (auth.role() = 'service_role');

-- RPC for Incomes
CREATE OR REPLACE FUNCTION public.create_clinic_income(
  p_clinic_id UUID,
  p_description TEXT,
  p_amount NUMERIC,
  p_category TEXT,
  p_date TEXT,
  p_tutor_id UUID DEFAULT NULL,
  p_services JSONB DEFAULT '[]'::jsonb
)
RETURNS SETOF public.incomes AS $$
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
  INSERT INTO public.incomes (clinic_id, description, amount, category, date, tutor_id, services)
  VALUES (p_clinic_id, p_description, p_amount, p_category, p_date::DATE, p_tutor_id, p_services)
  RETURNING *;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_clinic_incomes_secure(
  p_clinic_id UUID,
  p_start_date TIMESTAMP WITH TIME ZONE,
  p_end_date TIMESTAMP WITH TIME ZONE
)
RETURNS SETOF public.incomes AS $$
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
  FROM public.incomes
  WHERE clinic_id = p_clinic_id
    AND date >= p_start_date::DATE
    AND date <= p_end_date::DATE
  ORDER BY date DESC, created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
  v_appointment_income NUMERIC;
  v_manual_income NUMERIC;
  v_expenses NUMERIC;
  v_pending NUMERIC;
  v_count INTEGER;
BEGIN
  SELECT COALESCE(SUM(price), 0), COUNT(*)
  INTO v_appointment_income, v_count
  FROM public.appointments
  WHERE clinic_id = p_clinic_id
    AND appointment_date >= p_start_date
    AND appointment_date <= p_end_date
    AND payment_status IN ('paid', 'partial');

  SELECT COALESCE(SUM(amount), 0)
  INTO v_manual_income
  FROM public.incomes
  WHERE clinic_id = p_clinic_id
    AND date >= p_start_date::DATE
    AND date <= p_end_date::DATE;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_expenses
  FROM public.expenses
  WHERE clinic_id = p_clinic_id
    AND date >= p_start_date::DATE
    AND date <= p_end_date::DATE;

  SELECT COALESCE(SUM(price), 0)
  INTO v_pending
  FROM public.appointments
  WHERE clinic_id = p_clinic_id
    AND appointment_date >= p_start_date
    AND appointment_date <= p_end_date
    AND payment_status = 'pending';

  RETURN QUERY SELECT 
    (v_appointment_income + v_manual_income), 
    v_expenses, 
    ((v_appointment_income + v_manual_income) - v_expenses), 
    v_pending,
    v_count;
END;
$$ LANGUAGE plpgsql;

-- 4. SISTEMA DE CREDITOS IA Y MODELOS
ALTER TABLE clinic_settings 
ADD COLUMN IF NOT EXISTS ai_credits_monthly_limit INTEGER DEFAULT 500,
ADD COLUMN IF NOT EXISTS ai_credits_extra_balance INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS ai_active_model TEXT DEFAULT 'mini',
ADD COLUMN IF NOT EXISTS ai_credits_extra_4o INTEGER DEFAULT 0;

ALTER TABLE public.messages 
ADD COLUMN IF NOT EXISTS ai_model TEXT;

CREATE OR REPLACE FUNCTION get_all_clinics_usage()
RETURNS TABLE (
    clinic_id UUID,
    clinic_name TEXT,
    plan TEXT,
    monthly_limit INTEGER,
    extra_balance INTEGER,
    messages_used_this_month BIGINT
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY
    SELECT 
        cs.id as clinic_id,
        cs.clinic_name,
        cs.subscription_plan as plan,
        cs.ai_credits_monthly_limit as monthly_limit,
        cs.ai_credits_extra_balance as extra_balance,
        (
            SELECT count(*) 
            FROM messages m 
            WHERE m.clinic_id = cs.id 
              AND m.ai_generated = true 
              AND m.created_at >= date_trunc('month', now())
        ) as messages_used_this_month
    FROM clinic_settings cs;
END;
$$;

-- 5. DATOS BANCARIOS Y BASE DE CONOCIMIENTO
ALTER TABLE clinic_settings 
ADD COLUMN IF NOT EXISTS transfer_details TEXT;

CREATE TABLE IF NOT EXISTS public.knowledge_base (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    status TEXT NOT NULL DEFAULT 'active',
    sync_status TEXT DEFAULT 'synced',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS for knowledge_base
ALTER TABLE public.knowledge_base ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clinic members can manage knowledge_base" ON public.knowledge_base;
CREATE POLICY "Clinic members can manage knowledge_base"
  ON public.knowledge_base FOR ALL
  USING (clinic_id IN (SELECT clinic_id FROM public.clinic_members WHERE user_id = auth.uid() AND status = 'active'));

-- 6. SISTEMA DE FIDELIZACIÓN (LOYALTY & REFERRALS)
ALTER TABLE public.patients 
ADD COLUMN IF NOT EXISTS loyalty_points INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES public.patients(id),
ADD COLUMN IF NOT EXISTS referral_count INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.loyalty_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('earn', 'redeem', 'adjustment', 'referral_bonus')),
  points INTEGER NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

ALTER TABLE public.clinic_settings
ADD COLUMN IF NOT EXISTS loyalty_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS loyalty_points_percentage NUMERIC DEFAULT 5.0,
ADD COLUMN IF NOT EXISTS loyalty_referral_bonus INTEGER DEFAULT 500,
ADD COLUMN IF NOT EXISTS loyalty_welcome_bonus INTEGER DEFAULT 200,
ADD COLUMN IF NOT EXISTS loyalty_program_mode TEXT DEFAULT 'points', -- 'points', 'money', 'percentage'
ADD COLUMN IF NOT EXISTS loyalty_points_name TEXT DEFAULT 'Puntos',
ADD COLUMN IF NOT EXISTS loyalty_currency_symbol TEXT DEFAULT 'pts';

CREATE TABLE IF NOT EXISTS public.loyalty_rewards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    points_cost INTEGER NOT NULL,
    reward_type TEXT NOT NULL DEFAULT 'gift', -- 'points', 'money', 'percentage', 'gift', 'treatment'
    reward_value NUMERIC DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.loyalty_rewards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clinic members can manage loyalty_rewards" ON public.loyalty_rewards;
CREATE POLICY "Clinic members can manage loyalty_rewards"
  ON public.loyalty_rewards FOR ALL
  USING (clinic_id IN (SELECT clinic_id FROM public.clinic_members WHERE user_id = auth.uid() AND status = 'active'));

ALTER TABLE public.loyalty_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clinic members can read loyalty_transactions" ON public.loyalty_transactions;
CREATE POLICY "Clinic members can read loyalty_transactions"
  ON public.loyalty_transactions FOR SELECT
  USING (clinic_id IN (SELECT clinic_id FROM public.clinic_members WHERE user_id = auth.uid() AND status = 'active'));

DROP POLICY IF EXISTS "Clinic members can manage loyalty_transactions" ON public.loyalty_transactions;
CREATE POLICY "Clinic members can manage loyalty_transactions"
  ON public.loyalty_transactions FOR ALL
  USING (clinic_id IN (SELECT clinic_id FROM public.clinic_members WHERE user_id = auth.uid() AND status = 'active' AND role IN ('owner', 'admin')));

CREATE OR REPLACE FUNCTION public.generate_referral_code() RETURNS TRIGGER AS $$
DECLARE
  v_new_code TEXT;
  v_exists BOOLEAN;
BEGIN
  IF NEW.referral_code IS NULL THEN
    LOOP
      v_new_code := UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 8));
      SELECT EXISTS (SELECT 1 FROM public.patients WHERE referral_code = v_new_code) INTO v_exists;
      EXIT WHEN NOT v_exists;
    END LOOP;
    NEW.referral_code := v_new_code;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_generate_referral_code ON public.patients;
CREATE TRIGGER trigger_generate_referral_code
BEFORE INSERT ON public.patients
FOR EACH ROW EXECUTE FUNCTION public.generate_referral_code();

CREATE OR REPLACE FUNCTION public.handle_referral_bonus() RETURNS TRIGGER AS $$
DECLARE
  v_referral_bonus INTEGER;
  v_referrer_id UUID;
BEGIN
  SELECT loyalty_referral_bonus INTO v_referral_bonus
  FROM public.clinic_settings WHERE id = NEW.clinic_id;
  
  IF NEW.referred_by IS NOT NULL THEN
    INSERT INTO public.loyalty_transactions (clinic_id, patient_id, type, points, description)
    VALUES (NEW.clinic_id, NEW.referred_by, 'referral_bonus', v_referral_bonus, 'Bono por referir a ' || COALESCE(NEW.name, 'un amigo'));
    
    UPDATE public.patients 
    SET loyalty_points = loyalty_points + v_referral_bonus,
        referral_count = referral_count + 1
    WHERE id = NEW.referred_by;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_referral_bonus ON public.patients;
CREATE TRIGGER trigger_referral_bonus
AFTER INSERT ON public.patients
FOR EACH ROW
WHEN (NEW.referred_by IS NOT NULL)
EXECUTE FUNCTION public.handle_referral_bonus();

-- Actualización de Medical History con nuevos campos clínicos
ALTER TABLE public.medical_history 
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS anamnesis TEXT,
  ADD COLUMN IF NOT EXISTS physical_exam JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS vital_signs JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS weight NUMERIC;

-- Módulos de Vacunas y Parasitología
CREATE TABLE IF NOT EXISTS public.vaccines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id UUID REFERENCES public.patients(id) ON DELETE CASCADE,
  clinic_id UUID REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  application_date DATE NOT NULL,
  next_dose_date DATE,
  veterinarian_id UUID REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.deworming (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id UUID REFERENCES public.patients(id) ON DELETE CASCADE,
  clinic_id UUID REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  brand TEXT,
  weight NUMERIC,
  application_date DATE NOT NULL,
  next_dose_date DATE,
  veterinarian_id UUID REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
