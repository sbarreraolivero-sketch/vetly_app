
-- Migration: permanent_subscription_fix_v2
-- Description: Total repair of subscriptions and clinic_settings based on actual DB inspection.
-- Handles mandatory plan_id and missing appointment columns.

-- 1. REPAIR SUBSCRIPTIONS TABLE
DO $$ 
BEGIN 
    -- Relax non-null constraint on plan_id if it exists (to be compatible with Vetly code)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='subscriptions' AND column_name='plan_id') THEN
        ALTER TABLE public.subscriptions ALTER COLUMN plan_id DROP NOT NULL;
    END IF;

    -- Ensure all Vetly-specific columns exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='subscriptions' AND column_name='monthly_appointments_limit') THEN
        ALTER TABLE public.subscriptions ADD COLUMN monthly_appointments_limit INTEGER;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='subscriptions' AND column_name='monthly_appointments_used') THEN
        ALTER TABLE public.subscriptions ADD COLUMN monthly_appointments_used INTEGER DEFAULT 0;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='subscriptions' AND column_name='updated_at') THEN
        ALTER TABLE public.subscriptions ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
END $$;

-- 2. REPAIR CLINIC_SETTINGS TABLE
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clinic_settings' AND column_name='address') THEN
        ALTER TABLE public.clinic_settings ADD COLUMN address TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clinic_settings' AND column_name='clinic_address') THEN
        ALTER TABLE public.clinic_settings ADD COLUMN clinic_address TEXT;
    END IF;
END $$;

-- 3. ENSURE UNIQUE CONSTRAINT
-- Clean duplicates first (Postgres internal ctid)
DELETE FROM public.subscriptions a USING public.subscriptions b WHERE a.ctid < b.ctid AND a.clinic_id = b.clinic_id;

DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_clinic_id_key') THEN
        ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_clinic_id_key UNIQUE (clinic_id);
    END IF;
EXCEPTION WHEN others THEN NULL;
END $$;

-- 4. AUTO-SUBSCRIPTION TRIGGER
CREATE OR REPLACE FUNCTION public.handle_new_clinic_subscription_auto()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.subscriptions (
        clinic_id, 
        plan_id, 
        plan, 
        status, 
        monthly_appointments_limit, 
        monthly_appointments_used
    ) VALUES (
        NEW.id,
        COALESCE(NEW.subscription_plan, 'essence'),
        COALESCE(NEW.subscription_plan, 'essence'),
        'active',
        CASE WHEN NEW.subscription_plan = 'prestige' THEN -1 WHEN NEW.subscription_plan = 'radiance' THEN 500 ELSE 50 END,
        0
    ) ON CONFLICT (clinic_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_clinic_created_setup_subscription ON public.clinic_settings;
CREATE TRIGGER on_clinic_created_setup_subscription
    AFTER INSERT ON public.clinic_settings
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_clinic_subscription_auto();
