-- Migration to fix premature patient creation and correct trigger logic
-- Goal: 
-- 1. Ensure auto_link_appointment_patient ONLY links existing patients, doesn't create new ones.
-- 2. Ensure create_patient_on_appointment_completed fires on 'confirmed' or 'completed' and uses correct constraints.

-- 1. Redefine auto_link_appointment_patient to NOT create patients
CREATE OR REPLACE FUNCTION public.auto_link_appointment_patient()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_patient_id UUID;
BEGIN
  -- If patient_id already set, skip
  IF NEW.patient_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Try to find existing patient by phone + clinic (do NOT create)
  SELECT id INTO v_patient_id
  FROM public.patients
  WHERE phone_number = NEW.phone_number
    AND clinic_id = NEW.clinic_id
  LIMIT 1;

  NEW.patient_id := v_patient_id;
  RETURN NEW;
END;
$function$;

-- 2. Redefine create_patient_on_appointment_completed with correct status checks and conflict resolution
CREATE OR REPLACE FUNCTION public.create_patient_on_appointment_completed()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_patient_id UUID;
BEGIN
  -- Trigger when an appointment transitions to 'completed' OR 'confirmed'
  IF NEW.status IN ('completed', 'confirmed') AND (OLD.status IS NULL OR OLD.status NOT IN ('completed', 'confirmed')) THEN
    
    -- If patient is null, try to match by phone 
    IF NEW.patient_id IS NULL THEN
        SELECT id INTO v_patient_id
        FROM public.patients
        WHERE phone_number = NEW.phone_number
          AND clinic_id = NEW.clinic_id
        LIMIT 1;
    ELSE
        v_patient_id := NEW.patient_id;
    END IF;

    -- If still no patient found, insert new patient using correct clinic_id + phone_number constraint
    IF v_patient_id IS NULL THEN
        INSERT INTO public.patients (clinic_id, phone_number, name)
        VALUES (NEW.clinic_id, NEW.phone_number, NEW.patient_name)
        ON CONFLICT (clinic_id, phone_number) DO UPDATE SET name = EXCLUDED.name
        RETURNING id INTO v_patient_id;
        
        -- Link the newly created patient to the appointment
        NEW.patient_id := v_patient_id;
    END IF;

    -- Add service to service_interest
    IF v_patient_id IS NOT NULL AND NEW.service IS NOT NULL THEN
        UPDATE public.patients
        SET service_interest = CASE 
            WHEN service_interest IS NULL OR btrim(service_interest) = '' OR service_interest ILIKE '%No especificado%'
            THEN NEW.service 
            WHEN service_interest NOT ILIKE '%' || NEW.service || '%' 
            THEN service_interest || ', ' || NEW.service
            ELSE service_interest
        END
        WHERE id = v_patient_id;
    END IF;

    -- Set payment status to 'paid' if it was pending and appointment is completed
    IF NEW.status = 'completed' AND NEW.payment_status = 'pending' THEN
        NEW.payment_status := 'paid';
    END IF;

  END IF;

  RETURN NEW;
END;
$function$;

-- 3. Ensure triggers are correctly bound (re-creating for safety)
DROP TRIGGER IF EXISTS trg_auto_link_patient ON public.appointments;
CREATE TRIGGER trg_auto_link_patient
  BEFORE INSERT ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_link_appointment_patient();

DROP TRIGGER IF EXISTS trg_create_patient_on_completed ON public.appointments;
CREATE TRIGGER trg_create_patient_on_completed
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.create_patient_on_appointment_completed();
