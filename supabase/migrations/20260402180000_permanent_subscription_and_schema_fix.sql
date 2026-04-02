
-- Migration: permanent_subscription_fix
-- Description: Repairs the subscriptions table and clinic_settings schema to match code expectations.
-- Adds auto-creation triggers for all future clinics.

-- 1. REPAIR SUBSCRIPTIONS TABLE
DO $$ 
BEGIN 
    -- Ensure columns exist in subscriptions
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='subscriptions' AND column_name='monthly_appointments_limit') THEN
        ALTER TABLE public.subscriptions ADD COLUMN monthly_appointments_limit INTEGER;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='subscriptions' AND column_name='monthly_appointments_used') THEN
        ALTER TABLE public.subscriptions ADD COLUMN monthly_appointments_used INTEGER DEFAULT 0;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='subscriptions' AND column_name='status') THEN
        ALTER TABLE public.subscriptions ADD COLUMN status TEXT DEFAULT 'active';
    END IF;
END $$;

-- 2. REPAIR CLINIC_SETTINGS TABLE
DO $$ 
BEGIN 
    -- Ensure address columns exist (handle both for compatibility)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='clinic_settings' AND column_name='address') THEN
        ALTER TABLE public.clinic_settings ADD COLUMN address TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='clinic_settings' AND column_name='clinic_address') THEN
        ALTER TABLE public.clinic_settings ADD COLUMN clinic_address TEXT;
    END IF;
END $$;

-- 3. AUTO-SUBSCRIPTION TRIGGER
-- This ensures every NEW clinic gets a subscription record immediately.
CREATE OR REPLACE FUNCTION public.handle_new_clinic_subscription_auto()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.subscriptions (
        clinic_id,
        plan,
        status,
        monthly_appointments_limit,
        monthly_appointments_used
    ) VALUES (
        NEW.id,
        COALESCE(NEW.subscription_plan, 'essence'),
        'active',
        CASE 
            WHEN NEW.subscription_plan = 'prestige' THEN -1
            WHEN NEW.subscription_plan = 'radiance' THEN 500
            ELSE 50 
        END,
        0
    ) ON CONFLICT (clinic_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-create the trigger for safety
DROP TRIGGER IF EXISTS on_clinic_created_setup_subscription ON public.clinic_settings;
CREATE TRIGGER on_clinic_created_setup_subscription
    AFTER INSERT ON public.clinic_settings
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_clinic_subscription_auto();

-- 4. REBUILD get_user_clinics RPC (Resilient version)
CREATE OR REPLACE FUNCTION public.get_user_clinics()
RETURNS TABLE (
  clinic_id UUID,
  clinic_name TEXT,
  role user_role,
  status member_status,
  plan TEXT,
  address TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    cs.id as clinic_id,
    cs.clinic_name,
    cm.role,
    cm.status,
    cs.subscription_plan as plan,
    COALESCE(cs.clinic_address, cs.address, '') as address
  FROM public.clinic_members cm
  JOIN public.clinic_settings cs ON cm.clinic_id = cs.id
  WHERE cm.user_id = auth.uid()
  AND cm.status = 'active'
  ORDER BY cs.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
