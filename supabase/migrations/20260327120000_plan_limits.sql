-- Migration: Add subscription limits for agendas and reminders
-- Description: Adds columns to the subscriptions table to track and enforce limits for agendas and monthly reminders.

-- 0. Ensure 'plan' column exists (it might be missing if CREATE TABLE IF NOT EXISTS skipped it in previous migrations)
DO $$ 
BEGIN
    -- If 'subscription_plan' exists but 'plan' doesn't, rename it
    IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'subscriptions' AND column_name = 'subscription_plan') 
       AND NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'subscriptions' AND column_name = 'plan') THEN
        ALTER TABLE public.subscriptions RENAME COLUMN subscription_plan TO plan;
    END IF;

    -- If 'plan' still doesn't exist, add it
    IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'subscriptions' AND column_name = 'plan') THEN
        ALTER TABLE public.subscriptions ADD COLUMN plan TEXT DEFAULT 'essence';
    END IF;
END $$;

-- 1. Add columns to public.subscriptions
ALTER TABLE public.subscriptions 
ADD COLUMN IF NOT EXISTS max_agendas INTEGER,
ADD COLUMN IF NOT EXISTS monthly_reminders_limit INTEGER,
ADD COLUMN IF NOT EXISTS monthly_reminders_used INTEGER DEFAULT 0;

-- 2. Update existing subscriptions with default limits if needed
-- Essence (based on previous logic or current state)
UPDATE public.subscriptions 
SET max_agendas = 1, monthly_reminders_limit = 0 
WHERE plan = 'essence' AND max_agendas IS NULL;

-- Radiance
UPDATE public.subscriptions 
SET max_agendas = 5, monthly_reminders_limit = 50 
WHERE plan = 'radiance' AND max_agendas IS NULL;

-- Prestige
UPDATE public.subscriptions 
SET max_agendas = 1000, monthly_reminders_limit = 1000000 
WHERE plan = 'prestige' AND max_agendas IS NULL;

-- 3. Ensure clinic_settings has max_users sync (already exists but useful to check)
-- 4. RPC for safe increments
CREATE OR REPLACE FUNCTION public.increment_subscription_usage(
    clinic_uuid UUID,
    column_name TEXT
) RETURNS VOID AS $$
BEGIN
    EXECUTE format('UPDATE public.subscriptions SET %I = COALESCE(%I, 0) + 1 WHERE clinic_id = %L', column_name, column_name, clinic_uuid);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
