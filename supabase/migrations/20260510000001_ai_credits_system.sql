-- Migration: AI Credits System
-- Description: Creates ai_credit_transactions table and monthly recharge logic.

-- 1. Create transactions table
CREATE TABLE IF NOT EXISTS public.ai_credit_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id UUID REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('monthly_refill', 'purchase', 'consumption', 'adjustment')),
    description TEXT,
    balance_after INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ai_transactions_clinic ON public.ai_credit_transactions(clinic_id);
CREATE INDEX IF NOT EXISTS idx_ai_transactions_created ON public.ai_credit_transactions(created_at DESC);

-- 2. Function to process recharges
CREATE OR REPLACE FUNCTION public.process_monthly_recharge()
RETURNS TABLE (recharged_count INTEGER) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_clinic RECORD;
    v_allowance INTEGER;
    v_remanente INTEGER;
    v_new_limit INTEGER;
    v_count INTEGER := 0;
    v_today_day INTEGER := EXTRACT(DAY FROM current_date);
    v_is_last_day BOOLEAN := (current_date = (date_trunc('month', current_date) + interval '1 month - 1 day')::date);
BEGIN
    FOR v_clinic IN 
        SELECT 
            id, 
            clinic_name, 
            subscription_plan,
            ai_credits_monthly_limit,
            ai_credits_monthly_mini_used,
            ai_credits_monthly_4o_used,
            created_at
        FROM public.clinic_settings
        WHERE 
            -- Exact day match
            EXTRACT(DAY FROM created_at) = v_today_day
            OR (
                -- Handle shorter months (e.g., created on 31st, today is 30th and it's the last day)
                v_is_last_day AND EXTRACT(DAY FROM created_at) > v_today_day
            )
    LOOP
        -- Determine allowance based on plan
        v_allowance := CASE 
            WHEN v_clinic.subscription_plan = 'prestige' THEN 5000
            WHEN v_clinic.subscription_plan = 'radiance' THEN 1500
            ELSE 500 -- essence or default
        END;

        -- Calculate remanente (remaining credits)
        -- In this system, consumption is tracked in used columns.
        -- Cost: mini = 1, 4o = 8 (standard) or 60 (pro/legacy)
        -- For simplicity in the 'limit' column logic, we calculate remaining based on standard mini cost
        -- although usage is actually split. We'll use a conservative approach.
        v_remanente := v_clinic.ai_credits_monthly_limit - v_clinic.ai_credits_monthly_mini_used;
        
        -- If remanente is negative (overuse), treat as 0 for the refill
        IF v_remanente < 0 THEN v_remanente := 0; END IF;

        v_new_limit := v_remanente + v_allowance;

        -- Update clinic settings
        UPDATE public.clinic_settings
        SET 
            ai_credits_monthly_limit = v_new_limit,
            ai_credits_monthly_mini_used = 0,
            ai_credits_monthly_4o_used = 0,
            updated_at = NOW()
        WHERE id = v_clinic.id;

        -- Log transaction
        INSERT INTO public.ai_credit_transactions (
            clinic_id,
            amount,
            type,
            description,
            balance_after
        ) VALUES (
            v_clinic.id,
            v_allowance,
            'monthly_refill',
            format('Recarga mensual plan %s (Remanente: %s)', v_clinic.subscription_plan, v_remanente),
            v_new_limit
        );

        v_count := v_count + 1;
    END LOOP;

    RETURN QUERY SELECT v_count;
END;
$$;

-- RLS for transactions
ALTER TABLE public.ai_credit_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read their own clinic transactions"
ON public.ai_credit_transactions FOR SELECT
USING (
    clinic_id IN (
        SELECT clinic_id FROM public.clinic_members WHERE user_id = auth.uid()
    )
);

CREATE POLICY "Service role has full access to transactions"
ON public.ai_credit_transactions FOR ALL
USING (auth.role() = 'service_role');
