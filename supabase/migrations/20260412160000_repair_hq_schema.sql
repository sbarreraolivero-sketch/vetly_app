-- Migration: Repair HQ Schema and Columns
-- Description: Ensures all columns used by HQ exist to prevent HTTP 400/500 errors.

BEGIN;

-- 1. Ensure all columns in clinic_settings exist
DO $$ 
BEGIN 
    -- AI Related
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clinic_settings' AND column_name='ai_active_model') THEN
        ALTER TABLE public.clinic_settings ADD COLUMN ai_active_model TEXT DEFAULT 'gpt-4o-mini';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clinic_settings' AND column_name='ai_credits_monthly_limit') THEN
        ALTER TABLE public.clinic_settings ADD COLUMN ai_credits_monthly_limit INTEGER DEFAULT 500;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clinic_settings' AND column_name='ai_credits_extra_balance') THEN
        ALTER TABLE public.clinic_settings ADD COLUMN ai_credits_extra_balance INTEGER DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clinic_settings' AND column_name='ai_credits_extra_4o') THEN
        ALTER TABLE public.clinic_settings ADD COLUMN ai_credits_extra_4o INTEGER DEFAULT 0;
    END IF;

    -- Activation & Billing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clinic_settings' AND column_name='activation_status') THEN
        ALTER TABLE public.clinic_settings ADD COLUMN activation_status TEXT DEFAULT 'pending_activation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clinic_settings' AND column_name='subscription_plan') THEN
        ALTER TABLE public.clinic_settings ADD COLUMN subscription_plan TEXT DEFAULT 'free';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clinic_settings' AND column_name='trial_status') THEN
        ALTER TABLE public.clinic_settings ADD COLUMN trial_status TEXT DEFAULT 'not_started';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clinic_settings' AND column_name='billing_status') THEN
        ALTER TABLE public.clinic_settings ADD COLUMN billing_status TEXT DEFAULT 'none';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clinic_settings' AND column_name='trial_start_date') THEN
        ALTER TABLE public.clinic_settings ADD COLUMN trial_start_date TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clinic_settings' AND column_name='trial_end_date') THEN
        ALTER TABLE public.clinic_settings ADD COLUMN trial_end_date TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clinic_settings' AND column_name='currency') THEN
        ALTER TABLE public.clinic_settings ADD COLUMN currency TEXT DEFAULT 'USD';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clinic_settings' AND column_name='timezone') THEN
        ALTER TABLE public.clinic_settings ADD COLUMN timezone TEXT DEFAULT 'UTC';
    END IF;
END $$;

-- 2. Force refresh PostgREST cache
NOTIFY pgrst, 'reload schema';

COMMIT;
