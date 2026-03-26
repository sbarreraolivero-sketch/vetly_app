-- Fix patient creation logic
-- 1. Modify the existing before insert auto_link_appointment_patient so it doesn't create patients
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

-- 2. Create the new BEFORE UPDATE trigger function to insert patients ONLY when appointment is completed
CREATE OR REPLACE FUNCTION public.create_patient_on_appointment_completed()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_patient_id UUID;
BEGIN
  -- Only trigger when an appointment transitions to 'completed'
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    
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

    -- If still no patient found, insert new patient
    IF v_patient_id IS NULL THEN
        INSERT INTO public.patients (clinic_id, phone_number, name)
        VALUES (NEW.clinic_id, NEW.phone_number, NEW.patient_name)
        RETURNING id INTO v_patient_id;
        
        -- Link the newly created patient to the appointment
        NEW.patient_id := v_patient_id;
    END IF;

    -- Add service to service_interest and mark as 'paid' if it was left pending
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

    -- IMPORTANT: Assure we set payment status to paid when appointment completes if it wasn't already paid
    IF NEW.payment_status = 'pending' THEN
        NEW.payment_status := 'paid';
    END IF;

  END IF;

  RETURN NEW;
END;
$function$;

-- Drop and recreate trigger
DROP TRIGGER IF EXISTS trg_create_patient_on_completed ON public.appointments;
CREATE TRIGGER trg_create_patient_on_completed
BEFORE UPDATE ON public.appointments
FOR EACH ROW
EXECUTE FUNCTION public.create_patient_on_appointment_completed();
