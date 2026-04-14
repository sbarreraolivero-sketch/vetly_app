-- Move Loyalty & Referral system from Patients (Pets) to Tutors (Owners)
-- 1. Add loyalty columns to tutors if missing
ALTER TABLE public.tutors 
ADD COLUMN IF NOT EXISTS loyalty_points INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS referral_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES public.tutors(id),
ADD COLUMN IF NOT EXISTS last_loyalty_update TIMESTAMPTZ;

-- 2. Migrate existing data (Optional: only if data exists in patient table)
-- Assuming we want to consolidate points from all pets of a tutor into the tutor record
-- We'll take the sum of points and the first non-null referral code
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'patients' AND column_name = 'loyalty_points') THEN
        UPDATE public.tutors t
        SET 
            loyalty_points = COALESCE((SELECT SUM(loyalty_points) FROM public.patients p WHERE p.tutor_id = t.id), 0),
            referral_code = (SELECT referral_code FROM public.patients p WHERE p.tutor_id = t.id AND referral_code IS NOT NULL LIMIT 1),
            referral_count = COALESCE((SELECT SUM(referral_count) FROM public.patients p WHERE p.tutor_id = t.id), 0);
            
        -- Remove columns from patients to avoid confusion
        ALTER TABLE public.patients DROP COLUMN IF EXISTS loyalty_points;
        ALTER TABLE public.patients DROP COLUMN IF EXISTS referral_code;
        ALTER TABLE public.patients DROP COLUMN IF EXISTS referral_count;
        ALTER TABLE public.patients DROP COLUMN IF EXISTS referred_by;
    END IF;
END $$;

-- 3. Update loyalty_transactions table to point to tutors
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'loyalty_transactions' AND column_name = 'patient_id') THEN
        -- Add tutor_id column
        ALTER TABLE public.loyalty_transactions ADD COLUMN IF NOT EXISTS tutor_id UUID REFERENCES public.tutors(id);
        
        -- Migrate data (Join with patients to get the tutor_id)
        UPDATE public.loyalty_transactions lt
        SET tutor_id = p.tutor_id
        FROM public.patients p
        WHERE lt.patient_id = p.id;
        
        -- Fallback: if patient_id was actually a tutor_id (from before the split)
        UPDATE public.loyalty_transactions lt
        SET tutor_id = patient_id
        WHERE tutor_id IS NULL AND EXISTS (SELECT 1 FROM public.tutors t WHERE t.id = lt.patient_id);

        -- Final cleanup of loyalty_transactions
        ALTER TABLE public.loyalty_transactions DROP COLUMN IF EXISTS patient_id;
        ALTER TABLE public.loyalty_transactions ALTER COLUMN tutor_id SET NOT NULL;
    END IF;
END $$;

-- 4. Re-create Triggers for Tutors
-- Generate Referral Code for Tutors
CREATE OR REPLACE FUNCTION public.generate_tutor_referral_code()
RETURNS TRIGGER AS $$
DECLARE
    new_code TEXT;
    done BOOLEAN := FALSE;
BEGIN
    IF NEW.referral_code IS NOT NULL THEN
        RETURN NEW;
    END IF;
    
    WHILE NOT done LOOP
        new_code := upper(substring(md5(random()::text) from 1 for 6));
        IF NOT EXISTS (SELECT 1 FROM public.tutors WHERE referral_code = new_code) THEN
            done := TRUE;
        END IF;
    END LOOP;
    
    NEW.referral_code := new_code;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_generate_tutor_referral_code ON public.tutors;
CREATE TRIGGER trigger_generate_tutor_referral_code
    BEFORE INSERT ON public.tutors
    FOR EACH ROW
    EXECUTE FUNCTION public.generate_tutor_referral_code();

-- Handle Referral Bonus for Tutors
CREATE OR REPLACE FUNCTION public.handle_tutor_referral_bonus()
RETURNS TRIGGER AS $$
DECLARE
    v_referral_bonus INTEGER;
BEGIN
    IF NEW.referred_by IS NOT NULL THEN
        SELECT loyalty_referral_bonus INTO v_referral_bonus 
        FROM public.clinic_settings 
        WHERE id = NEW.clinic_id;

        IF v_referral_bonus > 0 THEN
            INSERT INTO public.loyalty_transactions (clinic_id, tutor_id, type, points, description)
            VALUES (NEW.clinic_id, NEW.referred_by, 'referral_bonus', v_referral_bonus, 'Bono por referir a ' || COALESCE(NEW.name, 'un nuevo tutor'));
            
            UPDATE public.tutors 
            SET loyalty_points = loyalty_points + v_referral_bonus,
                referral_count = referral_count + 1
            WHERE id = NEW.referred_by;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_handle_tutor_referral_bonus ON public.tutors;
CREATE TRIGGER trigger_handle_tutor_referral_bonus
    AFTER INSERT ON public.tutors
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_tutor_referral_bonus();
