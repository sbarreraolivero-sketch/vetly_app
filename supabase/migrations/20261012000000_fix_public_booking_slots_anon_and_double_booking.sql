-- Reservas online (/reservar/:slug): get_public_booking_slots llama a
-- get_available_slots -> check_availability, que desde la auditoría 2026-10-08
-- exigen is_clinic_member(). Un visitante anónimo nunca es miembro => "Acceso
-- denegado" y la página no mostraba ningún horario.
--
-- Solución: get_public_booking_slots (que ya valida public_booking_enabled)
-- marca la transacción con un GUC ligado al clinic_id; los dos guards lo
-- reconocen SOLO para esa clínica. El GUC es local a la transacción y no se puede
-- fijar desde PostgREST, así que no abre acceso entre clínicas.
--
-- Además: las reservas online se insertan con professional_id NULL, y
-- get_professional_available_slots solo bloquea citas con professional_id = X,
-- así que un horario ya reservado seguía apareciendo libre (doble reserva).
-- Se excluyen en la RPC pública los horarios que se solapan con citas sin profesional.

CREATE OR REPLACE FUNCTION public.get_available_slots(p_clinic_id uuid, p_date date, p_duration integer DEFAULT 60, p_timezone text DEFAULT 'America/Santiago'::text, p_interval integer DEFAULT 30, p_last_slot_cap time without time zone DEFAULT NULL::time without time zone)
 RETURNS TABLE(slot_time time without time zone, is_available boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_working_hours JSONB;
  v_dow INTEGER;
  v_day_name TEXT;
  v_day_hours JSONB;
  v_open_time TIME;
  v_close_time TIME;
  v_current_time TIME;
BEGIN
    IF COALESCE(auth.role(), 'service_role') <> 'service_role'
       AND current_setting('vetly.public_booking', true) IS DISTINCT FROM p_clinic_id::text
       AND NOT public.is_clinic_member(p_clinic_id) THEN
        RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
    END IF;
  IF EXISTS (SELECT 1 FROM public.clinic_blocked_dates WHERE clinic_id = p_clinic_id AND blocked_date = p_date) THEN
    RETURN;
  END IF;

  SELECT working_hours INTO v_working_hours
  FROM public.clinic_settings
  WHERE id = p_clinic_id;

  IF v_working_hours IS NULL THEN
    RETURN;
  END IF;

  v_dow := EXTRACT(DOW FROM p_date);
  v_day_name := CASE v_dow
    WHEN 1 THEN 'monday'
    WHEN 2 THEN 'tuesday'
    WHEN 3 THEN 'wednesday'
    WHEN 4 THEN 'thursday'
    WHEN 5 THEN 'friday'
    WHEN 6 THEN 'saturday'
    WHEN 0 THEN 'sunday'
  END;

  v_day_hours := v_working_hours->v_day_name;

  IF v_day_hours IS NULL OR v_day_hours = 'null'::jsonb OR (v_day_hours->>'enabled')::BOOLEAN IS FALSE THEN
    RETURN;
  END IF;

  v_open_time  := (COALESCE(v_day_hours->>'open',  v_day_hours->>'start', '09:00'))::TIME;
  v_close_time := (COALESCE(v_day_hours->>'close', v_day_hours->>'end',   '20:00'))::TIME;

  IF p_date = CURRENT_DATE THEN
    v_current_time := (CURRENT_TIMESTAMP AT TIME ZONE p_timezone)::TIME;
    IF v_current_time < v_open_time THEN
        v_current_time := v_open_time;
    END IF;
  ELSE
    v_current_time := v_open_time;
  END IF;

  LOOP
    IF p_last_slot_cap IS NOT NULL THEN
      EXIT WHEN v_current_time > p_last_slot_cap;
    ELSE
      EXIT WHEN v_current_time + (p_duration || ' minutes')::INTERVAL > v_close_time;
    END IF;

    slot_time := v_current_time;
    is_available := public.check_availability(p_clinic_id, p_date, v_current_time, p_duration, p_last_slot_cap);

    IF is_available THEN
        RETURN NEXT;
    END IF;

    v_current_time := v_current_time + (p_interval || ' minutes')::INTERVAL;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_availability(p_clinic_id uuid, p_date date, p_time time without time zone, p_duration integer DEFAULT 60, p_last_slot_cap time without time zone DEFAULT NULL::time without time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_timezone TEXT;
  v_any_prof_free BOOLEAN := FALSE;
  v_member_id UUID;
BEGIN
    IF COALESCE(auth.role(), 'service_role') <> 'service_role'
       AND current_setting('vetly.public_booking', true) IS DISTINCT FROM p_clinic_id::text
       AND NOT public.is_clinic_member(p_clinic_id) THEN
        RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
    END IF;
  IF EXISTS (SELECT 1 FROM public.clinic_blocked_dates WHERE clinic_id = p_clinic_id AND blocked_date = p_date) THEN
    RETURN FALSE;
  END IF;

  SELECT timezone INTO v_timezone FROM public.clinic_settings WHERE id = p_clinic_id;
  IF v_timezone IS NULL THEN v_timezone := 'America/Santiago'; END IF;

  FOR v_member_id IN (
    SELECT id FROM public.clinic_members
    WHERE clinic_id = p_clinic_id
      AND status = 'active'
      AND role NOT IN ('receptionist', 'admin')
  ) LOOP
    IF EXISTS (
        SELECT 1 FROM public.get_professional_available_slots(
          p_clinic_id,
          v_member_id,
          p_date,
          p_duration,
          30,
          v_timezone,
          p_last_slot_cap
        )
        WHERE to_char(slot_time, 'HH24:MI') = to_char(p_time, 'HH24:MI') AND is_available = TRUE
    ) THEN
        v_any_prof_free := TRUE;
        EXIT;
    END IF;
  END LOOP;

  RETURN v_any_prof_free;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_public_booking_slots(p_clinic_id uuid, p_date date, p_duration integer)
 RETURNS TABLE(slot_time time without time zone, is_available boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_timezone TEXT;
BEGIN
    SELECT COALESCE(timezone, 'America/Santiago') INTO v_timezone
    FROM public.clinic_settings
    WHERE id = p_clinic_id AND public_booking_enabled = true;

    IF v_timezone IS NULL THEN
        RETURN;
    END IF;

    PERFORM set_config('vetly.public_booking', p_clinic_id::text, true);

    RETURN QUERY
    SELECT s.slot_time, s.is_available
    FROM public.get_available_slots(p_clinic_id, p_date, p_duration, v_timezone) s
    WHERE NOT EXISTS (
        SELECT 1 FROM public.appointments a
        WHERE a.clinic_id = p_clinic_id
          AND a.professional_id IS NULL
          AND a.status NOT IN ('cancelled', 'no_show')
          AND (a.appointment_date AT TIME ZONE v_timezone)::date = p_date
          AND tsrange(
                (a.appointment_date AT TIME ZONE v_timezone),
                (a.appointment_date AT TIME ZONE v_timezone) + (COALESCE(a.duration_minutes, a.duration, 30) || ' minutes')::interval
              ) && tsrange(
                (p_date + s.slot_time),
                (p_date + s.slot_time) + (p_duration || ' minutes')::interval
              )
    );
END;
$function$;

-- Las 3 mantienen sus permisos: get_public_booking_slots anon/authenticated,
-- las otras dos solo authenticated/service_role (no se reexponen a anon).
REVOKE ALL ON FUNCTION public.get_available_slots(uuid, date, integer, text, integer, time) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.check_availability(uuid, date, time, integer, time) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_public_booking_slots(uuid, date, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_booking_slots(uuid, date, integer) TO anon, authenticated, service_role;
