-- ============================================================================
-- Motor de fidelización — parte 6: enlaces de referido y carnet digital
--
-- Bug: ambos RPCs devolvían `cs.ycloud_phone_number`, que quedó en NULL en las
-- dos clínicas al migrar a Meta Cloud API (sesiones 57 y 65). Resultado: el
-- enlace corto /r/:code y el botón "Agendar por WhatsApp" del carnet no llevaban
-- a ninguna parte. Aunque Claudia hubiera repartido los links, no habrían servido.
-- Se agrega fallback a contact_phone, que sí está poblado en ambas.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_referral_link_data(p_code text)
RETURNS TABLE(clinic_phone text, tutor_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT regexp_replace(COALESCE(cs.ycloud_phone_number, cs.contact_phone), '[^0-9]', '', 'g'),
         t.name
  FROM tutors t
  JOIN clinic_settings cs ON cs.id = t.clinic_id
  WHERE UPPER(t.referral_code) = UPPER(p_code)
    AND t.referral_code IS NOT NULL
  LIMIT 1;
END;
$$;

-- Carnet digital: además del fallback de teléfono, se agregan las reglas vigentes
-- del programa, los últimos movimientos de saldo, y se separan las próximas
-- atenciones de las pasadas (antes iban mezcladas en una sola lista de 6).
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
  SELECT id, clinic_id INTO v_tutor_id, v_clinic_id
  FROM tutors
  WHERE UPPER(referral_code) = UPPER(p_code) AND referral_code IS NOT NULL
  LIMIT 1;

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
        'type',        mv.type,
        'points',      mv.points,
        'description', mv.description,
        'created_at',  mv.created_at
      ) ORDER BY mv.created_at DESC)
      FROM (SELECT * FROM loyalty_transactions WHERE tutor_id = v_tutor_id
            ORDER BY created_at DESC LIMIT 8) mv
    ), '[]'::jsonb),
    'patients', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',            pat.id,
          'name',          pat.name,
          'species',       pat.species,
          'breed',         pat.breed,
          'sex',           pat.sex,
          'dob',           pat.dob,
          'is_sterilized', pat.is_sterilized,
          'vaccines', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'name',             vac.name,
              'application_date', vac.application_date,
              'next_dose_date',   vac.next_dose_date
            ) ORDER BY vac.application_date DESC)
            FROM (SELECT * FROM vaccines WHERE patient_id = pat.id ORDER BY application_date DESC LIMIT 6) vac
          ), '[]'::jsonb),
          'dewormings', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'type',             dew.type,
              'brand',            dew.brand,
              'application_date', dew.application_date,
              'next_dose_date',   dew.next_dose_date
            ) ORDER BY dew.application_date DESC)
            FROM (SELECT * FROM deworming WHERE patient_id = pat.id ORDER BY application_date DESC LIMIT 4) dew
          ), '[]'::jsonb),
          'medical_history', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'event_date',      mh.event_date,
              'event_type',      mh.event_type,
              'diagnosis',       mh.diagnosis,
              'procedure_notes', mh.procedure_notes,
              'weight',          mh.weight
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
          'status',  a.status,  'patient_name',     a.patient_name
        ) AS u
        FROM appointments a
        WHERE a.clinic_id = v_clinic_id
          AND (a.tutor_id = v_tutor_id
               OR a.phone_number = (SELECT phone_number FROM tutors WHERE id = v_tutor_id))
          AND a.status NOT IN ('cancelled', 'completed')
          AND a.appointment_date >= NOW()
        ORDER BY a.appointment_date ASC
        LIMIT 5
      ) s
    ), '[]'::jsonb),
    'appointments', COALESCE((
      SELECT jsonb_agg(appt ORDER BY (appt->>'appointment_date') DESC)
      FROM (
        SELECT jsonb_build_object(
          'service', a.service, 'appointment_date', a.appointment_date,
          'status',  a.status,  'patient_name',     a.patient_name
        ) AS appt
        FROM appointments a
        WHERE a.clinic_id = v_clinic_id
          AND (a.tutor_id = v_tutor_id
               OR a.phone_number = (SELECT phone_number FROM tutors WHERE id = v_tutor_id))
          AND a.status != 'cancelled'
          AND a.appointment_date < NOW()
        ORDER BY a.appointment_date DESC
        LIMIT 6
      ) sub
    ), '[]'::jsonb)
  ) INTO result
  FROM tutors t
  JOIN clinic_settings cs ON cs.id = t.clinic_id
  WHERE t.id = v_tutor_id;

  RETURN result;
END;
$$;
