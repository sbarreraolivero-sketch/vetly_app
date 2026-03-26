-- =============================================================
-- MIGRATION: Add patient_id FK to appointments
-- Purpose: Link appointments to patients table for retention scoring
-- =============================================================

-- 1. Add the column (nullable initially for backfill)
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS patient_id UUID REFERENCES public.patients(id) ON DELETE SET NULL;

-- 2. Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_appointments_patient_id
  ON public.appointments(patient_id);

-- 3. Backfill: match existing appointments to patients by phone_number + clinic_id
UPDATE public.appointments a
SET patient_id = p.id
FROM public.patients p
WHERE a.phone_number = p.phone_number
  AND a.clinic_id = p.clinic_id
  AND a.patient_id IS NULL;

-- 4. Auto-create patients for orphaned appointments
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
ORDER BY a.clinic_id, a.phone_number, a.created_at DESC;

-- 5. Backfill again after creating new patients
UPDATE public.appointments a
SET patient_id = p.id
FROM public.patients p
WHERE a.phone_number = p.phone_number
  AND a.clinic_id = p.clinic_id
  AND a.patient_id IS NULL;

-- 6. Update patient stats
UPDATE public.patients p
SET
  total_appointments = sub.cnt,
  last_appointment_at = sub.last_appt
FROM (
  SELECT
    patient_id,
    COUNT(*) as cnt,
    MAX(appointment_date) as last_appt
  FROM public.appointments
  WHERE patient_id IS NOT NULL
    AND status NOT IN ('cancelled')
  GROUP BY patient_id
) sub
WHERE p.id = sub.patient_id;

-- 7. Trigger: auto-link new appointments to patients
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
    INSERT INTO public.patients (clinic_id, phone_number, name)
    VALUES (NEW.clinic_id, NEW.phone_number, NEW.patient_name)
    ON CONFLICT (phone_number) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO v_patient_id;
  END IF;

  NEW.patient_id := v_patient_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_link_patient ON public.appointments;
CREATE TRIGGER trg_auto_link_patient
  BEFORE INSERT ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_link_appointment_patient();

-- 8. Trigger: update patient stats on appointment changes
CREATE OR REPLACE FUNCTION public.update_patient_stats()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.patients p
  SET
    total_appointments = (
      SELECT COUNT(*)
      FROM public.appointments
      WHERE patient_id = COALESCE(NEW.patient_id, OLD.patient_id)
        AND status NOT IN ('cancelled')
    ),
    last_appointment_at = (
      SELECT MAX(appointment_date)
      FROM public.appointments
      WHERE patient_id = COALESCE(NEW.patient_id, OLD.patient_id)
        AND status NOT IN ('cancelled')
    ),
    updated_at = NOW()
  WHERE id = COALESCE(NEW.patient_id, OLD.patient_id);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_patient_stats ON public.appointments;
CREATE TRIGGER trg_update_patient_stats
  AFTER INSERT OR UPDATE OR DELETE ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_patient_stats();
