-- =============================================================
-- MIGRATION: Fix Patient ID Fragmentation & Unique Constraints
-- Purpose:
-- 1. Drop the global UNIQUE (phone_number) constraint on patients.
-- 2. Add a composite UNIQUE (clinic_id, phone_number) constraint.
-- 3. Modify the auto_link_appointment_patient trigger to handle 
--    the composite conflict target correctly so new appointments
--    auto-link to the right patient per clinic.
-- =============================================================

-- 1. Drop the global unique constraint
ALTER TABLE public.patients
  DROP CONSTRAINT IF EXISTS patients_phone_number_key;

-- 2. Add the composite unique constraint (multi-tenant safe)
ALTER TABLE public.patients
  ADD CONSTRAINT patients_clinic_id_phone_number_key UNIQUE (clinic_id, phone_number);

-- 3. Replace the trigger function to use the correct ON CONFLICT target
CREATE OR REPLACE FUNCTION public.auto_link_appointment_patient()
RETURNS TRIGGER AS $$
DECLARE
  v_patient_id UUID;
BEGIN
  -- If patient_id already set, skip
  IF NEW.patient_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Try to find existing patient by phone + clinic
  SELECT id INTO v_patient_id
  FROM public.patients
  WHERE phone_number = NEW.phone_number
    AND clinic_id = NEW.clinic_id;

  -- If not found, create one
  IF v_patient_id IS NULL THEN
    INSERT INTO public.patients (clinic_id, phone_number, name)
    VALUES (NEW.clinic_id, NEW.phone_number, NEW.patient_name)
    ON CONFLICT (clinic_id, phone_number) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO v_patient_id;
  END IF;

  NEW.patient_id := v_patient_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Re-run backfill for unassigned appointments
UPDATE public.appointments a
SET patient_id = p.id
FROM public.patients p
WHERE a.phone_number = p.phone_number
  AND a.clinic_id = p.clinic_id
  AND a.patient_id IS NULL;

-- 5. Auto-create patients for any remaining orphaned appointments
INSERT INTO public.patients (clinic_id, phone_number, name, total_appointments, last_appointment_at)
SELECT DISTINCT ON (a.clinic_id, a.phone_number)
  a.clinic_id,
  a.phone_number,
  a.patient_name,
  0,
  NULL
FROM public.appointments a
WHERE a.patient_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.patients p
    WHERE p.phone_number = a.phone_number
      AND p.clinic_id = a.clinic_id
  )
ORDER BY a.clinic_id, a.phone_number, a.created_at DESC
ON CONFLICT (clinic_id, phone_number) DO NOTHING;

-- 6. Final Backfill
UPDATE public.appointments a
SET patient_id = p.id
FROM public.patients p
WHERE a.phone_number = p.phone_number
  AND a.clinic_id = p.clinic_id
  AND a.patient_id IS NULL;
