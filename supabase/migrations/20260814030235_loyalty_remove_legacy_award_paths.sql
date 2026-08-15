-- ============================================================================
-- Motor de fidelización — parte 3: eliminar los caminos viejos de otorgamiento
--
-- A partir de ahora la ÚNICA vía que acredita puntos automáticamente es
-- sync_income_loyalty(). Los tres mecanismos anteriores se retiran:
--
--  1. handle_tutor_referral_bonus (AFTER INSERT ON tutors): pagaba al referidor
--     en el mismo instante en que el referido mandaba el código por WhatsApp,
--     sin que comprara nunca. Y como el webhook usa UPDATE cuando el tutor ya
--     existe, en el resto de los casos no disparaba jamás.
--
--  2. El bloque de lealtad dentro de auto_create_tutor_and_patient_on_complete:
--     regalaba el bono de bienvenida a TODO cliente que completara su primera
--     cita, referido o no, y sin monto de compra sobre el cual calcular. Es el
--     origen de los 8.600 pts repartidos entre 42 tutores.
--
--  3. handle_referral_bonus: función huérfana (sin trigger) que insertaba en
--     loyalty_transactions.patient_id, columna que ya no existe.
-- ============================================================================

DROP TRIGGER IF EXISTS trigger_handle_tutor_referral_bonus ON public.tutors;
DROP FUNCTION IF EXISTS public.handle_tutor_referral_bonus();
DROP FUNCTION IF EXISTS public.handle_referral_bonus();

-- Reescritura de auto_create_tutor_and_patient_on_complete SIN el bloque de
-- lealtad. Todo lo demás (crear tutor, crear paciente, vincular la cita) queda
-- exactamente igual: sigue siendo el mecanismo que puebla contactos al completar.
CREATE OR REPLACE FUNCTION public.auto_create_tutor_and_patient_on_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_normalized_phone TEXT;
  v_tutor_id         UUID;
  v_patient_id       UUID;
  v_tutor_name       TEXT;
BEGIN
  IF NEW.status != 'completed' OR OLD.status = 'completed' THEN
    RETURN NEW;
  END IF;

  IF NEW.clinic_id IS NULL OR NEW.phone_number IS NULL OR TRIM(NEW.phone_number) = '' THEN
    RETURN NEW;
  END IF;

  v_normalized_phone := regexp_replace(NEW.phone_number, '[^0-9]', '', 'g');
  IF v_normalized_phone = '' THEN RETURN NEW; END IF;

  v_tutor_name := COALESCE(NULLIF(TRIM(NEW.tutor_name), ''), 'Sin nombre');

  INSERT INTO tutors (clinic_id, phone_number, name, address, latitude, longitude, created_at, updated_at)
  VALUES (NEW.clinic_id, v_normalized_phone, v_tutor_name, NEW.address, NEW.latitude, NEW.longitude, NOW(), NOW())
  ON CONFLICT (clinic_id, phone_number) DO UPDATE
    SET
      name      = CASE WHEN tutors.name IS NULL OR tutors.name = 'Sin nombre'
                       THEN EXCLUDED.name ELSE tutors.name END,
      address   = COALESCE(tutors.address, EXCLUDED.address),
      latitude  = COALESCE(tutors.latitude, EXCLUDED.latitude),
      longitude = COALESCE(tutors.longitude, EXCLUDED.longitude),
      updated_at = NOW()
  RETURNING id INTO v_tutor_id;

  IF v_tutor_id IS NULL THEN
    SELECT id INTO v_tutor_id FROM tutors
    WHERE clinic_id = NEW.clinic_id AND phone_number = v_normalized_phone
    LIMIT 1;
  END IF;

  IF v_tutor_id IS NULL THEN RETURN NEW; END IF;

  IF NEW.patient_name IS NOT NULL AND TRIM(NEW.patient_name) != '' THEN
    SELECT id INTO v_patient_id FROM patients
    WHERE tutor_id = v_tutor_id
      AND LOWER(TRIM(name)) = LOWER(TRIM(NEW.patient_name))
      AND (death_date IS NULL OR death_date > NOW())
    LIMIT 1;

    IF v_patient_id IS NULL THEN
      INSERT INTO patients (clinic_id, tutor_id, name, status, created_at, updated_at)
      VALUES (NEW.clinic_id, v_tutor_id, TRIM(NEW.patient_name), 'alive', NOW(), NOW())
      RETURNING id INTO v_patient_id;
    END IF;
  END IF;

  UPDATE appointments
  SET
    tutor_id = COALESCE(NEW.tutor_id, v_tutor_id),
    pet_id   = COALESCE(NEW.pet_id, v_patient_id)
  WHERE id = NEW.id;

  -- Los puntos ya NO se otorgan aquí. La acumulación vive en sync_income_loyalty(),
  -- que se dispara con la venta registrada en Finanzas (única fuente con monto).
  RETURN NEW;
END;
$$;
