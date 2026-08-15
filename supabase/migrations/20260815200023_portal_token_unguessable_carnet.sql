-- ============================================================================
-- Carnet digital: identificador no adivinable
--
-- Problema: /p/:code se identificaba con `referral_code`, 6 caracteres HEX =
-- 16.777.216 combinaciones. Con 713 tutores, 1 de cada ~23.500 intentos acierta:
-- minutos de fuerza bruta para exponer nombre, mascotas, historial médico con
-- diagnósticos y saldo.
--
-- No se alarga `referral_code` porque cumple otra función con otro riesgo: es el
-- código que el cliente dicta por WhatsApp para referir a un amigo, y adivinarlo
-- solo permite atribuirse una recomendación. Se separan los dos conceptos.
--
-- Ventana: el enlace del carnet estuvo roto hasta ayer (apuntaba a un teléfono
-- NULL tras la migración a Meta), así que nadie tenía un identificador en uso y
-- regenerar no rompió nada.
--
-- OJO: el token es base64url, SENSIBLE A MAYÚSCULAS. PetOwnerPortal.tsx dejó de
-- hacer `.toUpperCase()` sobre el parámetro de la URL por este motivo.
-- ============================================================================

ALTER TABLE public.tutors ADD COLUMN IF NOT EXISTS portal_token TEXT;

-- 22 caracteres base64url sobre 16 bytes de gen_random_bytes: ~3,4 × 10^38
-- combinaciones. Deja de ser enumerable por completo.
CREATE OR REPLACE FUNCTION public.generate_portal_token()
RETURNS TEXT
LANGUAGE sql
VOLATILE
AS $$
    SELECT translate(encode(gen_random_bytes(16), 'base64'), '+/=', '-_');
$$;

UPDATE public.tutors
SET portal_token = public.generate_portal_token()
WHERE portal_token IS NULL;

ALTER TABLE public.tutors ALTER COLUMN portal_token SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tutors_portal_token_key') THEN
        ALTER TABLE public.tutors ADD CONSTRAINT tutors_portal_token_key UNIQUE (portal_token);
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_portal_token()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.portal_token IS NULL THEN
        NEW.portal_token := public.generate_portal_token();
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_set_portal_token ON public.tutors;
CREATE TRIGGER trigger_set_portal_token
    BEFORE INSERT ON public.tutors
    FOR EACH ROW EXECUTE FUNCTION public.set_portal_token();

-- El carnet pasa a resolverse por portal_token. Un código de 6 caracteres ya no
-- abre nada. get_referral_link_data NO cambia: sigue por referral_code.
CREATE OR REPLACE FUNCTION public.get_pet_owner_portal(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tutor_id  UUID;
  v_clinic_id UUID;
  result      JSONB;
BEGIN
  -- Comparación exacta y sensible a mayúsculas: el token no es dictable, así que
  -- no se normaliza como el referral_code.
  SELECT id, clinic_id INTO v_tutor_id, v_clinic_id
  FROM tutors WHERE portal_token = p_code LIMIT 1;

  IF v_tutor_id IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
    'tutor', jsonb_build_object(
      'name',           t.name,
      'loyalty_points', COALESCE(t.loyalty_points, 0),
      'referral_code',  t.referral_code,
      'referral_count', COALESCE(t.referral_count, 0)
    ),
    'clinic', jsonb_build_object(
      'name',                    cs.clinic_name,
      'phone',                   regexp_replace(COALESCE(cs.ycloud_phone_number, cs.contact_phone), '[^0-9]', '', 'g'),
      'loyalty_points_name',     cs.loyalty_points_name,
      'loyalty_currency_symbol', cs.loyalty_currency_symbol,
      'loyalty_enabled',         cs.loyalty_enabled,
      'earn_percentage',         COALESCE(cs.loyalty_points_percentage, 0),
      'welcome_bonus',           COALESCE(cs.loyalty_welcome_bonus, 0),
      'welcome_bonus_type',      cs.loyalty_welcome_bonus_type,
      'referral_bonus',          COALESCE(cs.loyalty_referral_bonus, 0)
    ),
    'loyalty_movements', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'type', mv.type, 'points', mv.points,
        'description', mv.description, 'created_at', mv.created_at
      ) ORDER BY mv.created_at DESC)
      FROM (SELECT * FROM loyalty_transactions WHERE tutor_id = v_tutor_id
            ORDER BY created_at DESC LIMIT 8) mv
    ), '[]'::jsonb),
    'patients', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', pat.id, 'name', pat.name, 'species', pat.species, 'breed', pat.breed,
          'sex', pat.sex, 'dob', pat.dob, 'is_sterilized', pat.is_sterilized,
          'vaccines', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'name', vac.name, 'application_date', vac.application_date,
              'next_dose_date', vac.next_dose_date
            ) ORDER BY vac.application_date DESC)
            FROM (SELECT * FROM vaccines WHERE patient_id = pat.id ORDER BY application_date DESC LIMIT 6) vac
          ), '[]'::jsonb),
          'dewormings', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'type', dew.type, 'brand', dew.brand,
              'application_date', dew.application_date, 'next_dose_date', dew.next_dose_date
            ) ORDER BY dew.application_date DESC)
            FROM (SELECT * FROM deworming WHERE patient_id = pat.id ORDER BY application_date DESC LIMIT 4) dew
          ), '[]'::jsonb),
          'medical_history', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'event_date', mh.event_date, 'event_type', mh.event_type,
              'diagnosis', mh.diagnosis, 'procedure_notes', mh.procedure_notes, 'weight', mh.weight
            ) ORDER BY mh.event_date DESC)
            FROM (SELECT * FROM medical_history WHERE patient_id = pat.id ORDER BY event_date DESC LIMIT 5) mh
          ), '[]'::jsonb)
        ) ORDER BY pat.name
      )
      FROM patients pat
      WHERE pat.tutor_id = v_tutor_id
        AND pat.status = 'alive'
        AND (pat.death_date IS NULL OR pat.death_date > NOW())
    ), '[]'::jsonb),
    'upcoming', COALESCE((
      SELECT jsonb_agg(u ORDER BY (u->>'appointment_date') ASC)
      FROM (
        SELECT jsonb_build_object(
          'service', a.service, 'appointment_date', a.appointment_date,
          'status', a.status, 'patient_name', a.patient_name
        ) AS u
        FROM appointments a
        WHERE a.clinic_id = v_clinic_id
          AND (a.tutor_id = v_tutor_id
               OR a.phone_number = (SELECT phone_number FROM tutors WHERE id = v_tutor_id))
          AND a.status NOT IN ('cancelled', 'completed')
          AND a.appointment_date >= NOW()
        ORDER BY a.appointment_date ASC LIMIT 5
      ) s
    ), '[]'::jsonb),
    'appointments', COALESCE((
      SELECT jsonb_agg(appt ORDER BY (appt->>'appointment_date') DESC)
      FROM (
        SELECT jsonb_build_object(
          'service', a.service, 'appointment_date', a.appointment_date,
          'status', a.status, 'patient_name', a.patient_name
        ) AS appt
        FROM appointments a
        WHERE a.clinic_id = v_clinic_id
          AND (a.tutor_id = v_tutor_id
               OR a.phone_number = (SELECT phone_number FROM tutors WHERE id = v_tutor_id))
          AND a.status != 'cancelled'
          AND a.appointment_date < NOW()
        ORDER BY a.appointment_date DESC LIMIT 6
      ) sub
    ), '[]'::jsonb)
  ) INTO result
  FROM tutors t JOIN clinic_settings cs ON cs.id = t.clinic_id
  WHERE t.id = v_tutor_id;

  RETURN result;
END;
$$;
