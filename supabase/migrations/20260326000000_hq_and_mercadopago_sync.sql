
-- =============================================================
-- HQ ADMIN & MERCADO PAGO INTEGRATION SYNC
-- =============================================================

-- 1. Update clinic_settings with AI and Mercado Pago fields
ALTER TABLE public.clinic_settings 
ADD COLUMN IF NOT EXISTS ai_credits_monthly_limit INTEGER DEFAULT 500,
ADD COLUMN IF NOT EXISTS ai_credits_extra_balance INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS ai_credits_extra_4o INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS ai_active_model TEXT DEFAULT 'mini',
ADD COLUMN IF NOT EXISTS subscription_plan TEXT DEFAULT 'essence',
ADD COLUMN IF NOT EXISTS activation_status TEXT DEFAULT 'pending_activation' CHECK (activation_status IN ('pending_activation', 'active', 'inactive')),
ADD COLUMN IF NOT EXISTS trial_status TEXT DEFAULT 'not_started' CHECK (trial_status IN ('not_started', 'running', 'converted', 'cancelled')),
ADD COLUMN IF NOT EXISTS billing_status TEXT DEFAULT 'none' CHECK (billing_status IN ('none', 'card_verified', 'active_subscription', 'payment_failed')),
ADD COLUMN IF NOT EXISTS trial_start_date TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS trial_end_date TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS mercadopago_customer_id TEXT,
ADD COLUMN IF NOT EXISTS mercadopago_card_id TEXT;

-- 2. Create subscriptions table if not exists
CREATE TABLE IF NOT EXISTS public.subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id UUID REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
    plan TEXT NOT NULL CHECK (plan IN ('essence', 'radiance', 'prestige', 'trial')),
    status TEXT NOT NULL CHECK (status IN ('active', 'cancelled', 'past_due', 'trial')),
    mercadopago_subscription_id TEXT,
    mercadopago_payment_id TEXT,
    current_period_start TIMESTAMPTZ DEFAULT NOW(),
    current_period_end TIMESTAMPTZ,
    trial_start TIMESTAMPTZ,
    trial_end TIMESTAMPTZ,
    trial_ends_at TIMESTAMPTZ,
    monthly_appointments_limit INTEGER,
    monthly_appointments_used INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(clinic_id)
);

-- 3. RLS for subscriptions
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    DROP POLICY IF EXISTS "Allow full access for authenticated users on subscriptions" ON public.subscriptions;
    CREATE POLICY "Allow full access for authenticated users on subscriptions" ON public.subscriptions FOR ALL USING (auth.role() = 'authenticated');
    
    DROP POLICY IF EXISTS "Service role access subscriptions" ON public.subscriptions;
    CREATE POLICY "Service role access subscriptions" ON public.subscriptions FOR ALL USING (auth.role() = 'service_role');
END $$;

-- 4. RPC for HQ Admin AI Usage Tracking
CREATE OR REPLACE FUNCTION get_all_clinics_usage()
RETURNS TABLE (
    clinic_id UUID,
    clinic_name TEXT,
    plan TEXT,
    monthly_limit INTEGER,
    extra_balance INTEGER,
    extra_4o_balance INTEGER,
    active_model TEXT,
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
        cs.ai_credits_extra_4o as extra_4o_balance,
        cs.ai_active_model as active_model,
        (
            SELECT count(*) 
            FROM public.messages m 
            WHERE m.clinic_id = cs.id 
              AND m.ai_generated = true 
              AND m.created_at >= date_trunc('month', now())
        ) as messages_used_this_month
    FROM public.clinic_settings cs;
END;
$$;

-- 5. Trigger for subscriptions updated_at
DROP TRIGGER IF EXISTS update_subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
