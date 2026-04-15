
-- FIX: Lógica de creación de pacientes y filtros de especie
-- 1. Redefinir la función para que no sobrescriba pacientes con el mismo teléfono
CREATE OR REPLACE FUNCTION public.create_patient_on_appointment_completed()
 RETURNS trigger
 LANGUAGE plpgsql
 AS $function$
DECLARE
  v_patient_id UUID;
BEGIN
  -- Activar en 'completed' o 'confirmed'
  IF NEW.status IN ('completed', 'confirmed') THEN
    
    -- Buscar por CLINICA + TELEFONO + NOMBRE (evita mezclar mascotas del mismo dueño)
    IF NEW.patient_id IS NULL THEN
        SELECT id INTO v_patient_id
        FROM public.patients
        WHERE phone_number = NEW.phone_number
          AND clinic_id = NEW.clinic_id
          AND lower(name) = lower(NEW.patient_name)
        LIMIT 1;
    ELSE
        v_patient_id := NEW.patient_id;
    END IF;

    -- Si no existe la mascota específica, crearla
    IF v_patient_id IS NULL THEN
        INSERT INTO public.patients (clinic_id, phone_number, name, species)
        VALUES (
            NEW.clinic_id, 
            NEW.phone_number, 
            NEW.patient_name,
            -- Intentar inferir especie del servicio si es posible, o dejar pendiente
            CASE WHEN NEW.service ILIKE '%Canino%' OR NEW.service ILIKE '%Perro%' THEN 'Perro'
                 WHEN NEW.service ILIKE '%Felino%' OR NEW.service ILIKE '%Gato%' THEN 'Gato'
                 ELSE 'No especificada' END
        )
        RETURNING id INTO v_patient_id;
        
        NEW.patient_id := v_patient_id;
    END IF;

    -- Actualizar intereses
    IF v_patient_id IS NOT NULL AND NEW.service IS NOT NULL THEN
        UPDATE public.patients
        SET service_interest = CASE 
            WHEN service_interest IS NULL OR btrim(service_interest) = ''
            THEN NEW.service 
            WHEN service_interest NOT ILIKE '%' || NEW.service || '%' 
            THEN service_interest || ', ' || NEW.service
            ELSE service_interest
        END
        WHERE id = v_patient_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 2. Asegurar que el trigger corra en INSERT y UPDATE
DROP TRIGGER IF EXISTS trg_create_patient_on_completed ON public.appointments;
CREATE TRIGGER trg_create_patient_on_completed
BEFORE INSERT OR UPDATE ON public.appointments
FOR EACH ROW
EXECUTE FUNCTION public.create_patient_on_appointment_completed();
