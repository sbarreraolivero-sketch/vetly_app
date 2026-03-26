-- Fix patients table unique constraint to be per clinic
-- And update the auto-link trigger to handle the new constraint

-- 1. Drop old global unique constraint
ALTER TABLE public.patients DROP CONSTRAINT IF EXISTS patients_phone_number_key;

-- 2. Add new unique constraint per clinic
ALTER TABLE public.patients ADD CONSTRAINT patients_clinic_phone_key UNIQUE (clinic_id, phone_number);

-- 3. Update the trigger function to use the composite key for conflict resolution
CREATE OR REPLACE FUNCTION public.auto_link_appointment_patient()
RETURNS TRIGGER AS $$
DECLARE
  v_patient_id UUID;
BEGIN
  IF NEW.patient_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_patient_id
  FROM public.patients
  WHERE phone_number = NEW.phone_number
    AND clinic_id = NEW.clinic_id;

  IF v_patient_id IS NULL THEN
    -- This now handles conflict on (clinic_id, phone_number)
    INSERT INTO public.patients (clinic_id, phone_number, name)
    VALUES (NEW.clinic_id, NEW.phone_number, NEW.patient_name)
    ON CONFLICT (clinic_id, phone_number) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO v_patient_id;
  END IF;

  NEW.patient_id := v_patient_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
