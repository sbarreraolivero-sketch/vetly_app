-- Fix: Add missing service_interest column to patients table
-- The trigger create_patient_on_appointment_completed tries to update this column
-- but it doesn't exist, causing "column service_interest does not exist" error

ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS service_interest TEXT;

-- Recreate the trigger function with safe handling
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

    -- If still no patient found, insert new patient
    IF v_patient_id IS NULL THEN
        INSERT INTO public.patients (clinic_id, phone_number, name)
        VALUES (NEW.clinic_id, NEW.phone_number, NEW.patient_name)
        ON CONFLICT (phone_number) DO UPDATE SET name = EXCLUDED.name
        RETURNING id INTO v_patient_id;
        
        -- Link the newly created patient to the appointment
        NEW.patient_id := v_patient_id;
    END IF;

    -- Add service to service_interest (now the column exists)
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

    -- IMPORTANT: Set payment status to 'paid' so it sums up in finance correctly
    IF NEW.payment_status = 'pending' THEN
        NEW.payment_status := 'paid';
    END IF;

  END IF;

  RETURN NEW;
END;
$function$;
