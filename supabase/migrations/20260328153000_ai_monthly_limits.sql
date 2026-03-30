-- Migration: AI Monthly Limits and Reset
-- Description: Adds columns to track monthly GPT-4o usage and limits, and resets them monthly.

-- 1. Add columns to clinic_settings
ALTER TABLE public.clinic_settings 
ADD COLUMN IF NOT EXISTS ai_credits_monthly_4o_limit INTEGER DEFAULT 100,
ADD COLUMN IF NOT EXISTS ai_credits_monthly_mini_used INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS ai_credits_monthly_4o_used INTEGER DEFAULT 0;

-- 2. Update get_all_clinics_usage RPC to be more accurate and include 4o limits
DROP FUNCTION IF EXISTS public.get_all_clinics_usage();

CREATE OR REPLACE FUNCTION public.get_all_clinics_usage()
RETURNS TABLE (
    clinic_id UUID,
    clinic_name TEXT,
    plan TEXT,
    monthly_mini_limit INTEGER,
    monthly_mini_used INTEGER,
    monthly_4o_limit INTEGER,
    monthly_4o_used INTEGER,
    extra_balance INTEGER,
    extra_4o_balance INTEGER,
    active_model TEXT
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY
    SELECT 
        cs.id as clinic_id,
        cs.clinic_name,
        cs.subscription_plan as plan,
        cs.ai_credits_monthly_limit as monthly_mini_limit,
        cs.ai_credits_monthly_mini_used as monthly_mini_used,
        cs.ai_credits_monthly_4o_limit as monthly_4o_limit,
        cs.ai_credits_monthly_4o_used as monthly_4o_used,
        cs.ai_credits_extra_balance as extra_balance,
        cs.ai_credits_extra_4o as extra_4o_balance,
        cs.ai_active_model as active_model
    FROM public.clinic_settings cs;
END;
$$;

-- 3. Reset procedure for monthly credits
CREATE OR REPLACE FUNCTION public.reset_monthly_ai_usage()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    UPDATE public.clinic_settings
    SET 
        ai_credits_monthly_mini_used = 0,
        ai_credits_monthly_4o_used = 0;
END;
$$;

-- 4. Schedule reset with pg_cron if available (1st of each month at midnight)
DO $$ 
BEGIN
    IF EXISTS (SELECT FROM pg_extension WHERE extname = 'pg_cron') THEN
        -- Safely schedule or reschedule the job
        PERFORM cron.schedule(
            'monthly-ai-reset',
            '0 0 1 * *',
            'SELECT public.reset_monthly_ai_usage()'
        );
    END IF;
END $$;
