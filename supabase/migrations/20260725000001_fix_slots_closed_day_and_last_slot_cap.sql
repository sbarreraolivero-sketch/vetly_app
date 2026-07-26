-- ============================================================================
-- Sesión 58 (2026-07-25) — Agendamiento: día cerrado + último horario del día
--
-- FIX 1 — BUG DEL SÁBADO (afecta a cualquier clínica del producto):
--   get_professional_available_slots cortaba con:
--       IF v_working_hours->v_day_name IS NULL THEN RETURN;
--   Ese guard NO cubre los dos modos reales de "día cerrado" que guarda la app:
--     a) JSONB null  -> Settings.tsx guarda {"saturday": null}.
--        '{"saturday":null}'::jsonb -> 'saturday'  NO es SQL NULL, es 'null'::jsonb.
--     b) {"enabled": false} -> MyProfile.tsx guarda {enabled,start,end}
--        y su DEFAULT_HOURS trae saturday {enabled:false, start:'09:00', end:'13:00'}.
--   Al no cortar, caía al COALESCE y generaba slots en días cerrados.
--   Comprobado en producción: sábado 2026-07-25 devolvía 7 slots (09:00-12:00),
--   que es exactamente lo que el agente ofreció a un cliente siendo L-V.
--
-- FIX 2 — ÚLTIMO HORARIO DEL DÍA (p_last_slot_cap):
--   El último slot ofrecido debe poder ser el tope (18:00) aunque el servicio
--   termine pasado el cierre. Con DEFAULT NULL el comportamiento previo queda
--   intacto para todos los consumidores existentes (ai-simulator, frontend).
--   El cap se propaga también a check_availability, que delega en el RPC de
--   profesional: sin propagarlo, el slot tope nunca aparecía como disponible.
--   Los webhooks lo pasan solo para servicios normales, nunca para cirugías.
-- ============================================================================

-- Nota: las firmas antiguas se eliminan porque agregar un parámetro crea una
-- sobrecarga nueva; convivir con la anterior dejaría el bug vivo y volvería
-- ambigua la resolución al llamar sin el parámetro.
DROP FUNCTION IF EXISTS public.get_available_slots(uuid, date, integer, text, integer);
DROP FUNCTION IF EXISTS public.get_professional_available_slots(uuid, uuid, date, integer, integer, text);
DROP FUNCTION IF EXISTS public.check_availability(uuid, date, time without time zone, integer);

CREATE OR REPLACE FUNCTION public.get_professional_available_slots(
  p_clinic_id uuid,
  p_member_id uuid,
  p_date date,
  p_duration integer DEFAULT 60,
  p_interval integer DEFAULT 30,
  p_timezone text DEFAULT 'America/Santiago'::text,
  p_last_slot_cap time without time zone DEFAULT NULL
)
RETURNS TABLE(slot_time time without time zone, is_available boolean)
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  v_working_hours JSONB;
  v_day_name TEXT;
  v_day_hours JSONB;
  v_prof_start TIME;
  v_prof_end TIME;
  v_current_slot TIMESTAMP;
  v_effective_end TIMESTAMP;
  v_busy_ranges TSRANGE[];
  v_duration_col TEXT;
  v_cap_ts TIMESTAMP;
BEGIN
  IF EXISTS (SELECT 1 FROM public.clinic_blocked_dates WHERE clinic_id = p_clinic_id AND blocked_date = p_date) THEN
    RETURN;
  END IF;

  SELECT column_name INTO v_duration_col
  FROM information_schema.columns
  WHERE table_name = 'appointments' AND column_name IN ('duration', 'duration_minutes')
  LIMIT 1;

  SELECT COALESCE(working_hours, (SELECT working_hours FROM public.clinic_settings WHERE id = p_clinic_id))
  INTO v_working_hours FROM public.clinic_members WHERE id = p_member_id;

  IF v_working_hours IS NULL THEN RETURN; END IF;

  v_day_name := CASE EXTRACT(DOW FROM p_date)
    WHEN 1 THEN 'monday' WHEN 2 THEN 'tuesday' WHEN 3 THEN 'wednesday'
    WHEN 4 THEN 'thursday' WHEN 5 THEN 'friday' WHEN 6 THEN 'saturday'
    WHEN 0 THEN 'sunday'
  END;

  v_day_hours := v_working_hours -> v_day_name;

  -- FIX 1: cubrir los tres modos de "día cerrado"
  IF v_day_hours IS NULL
     OR v_day_hours = 'null'::jsonb
     OR (v_day_hours->>'enabled')::BOOLEAN IS FALSE THEN
    RETURN;
  END IF;

  v_prof_start := (COALESCE(v_day_hours->>'open',  v_day_hours->>'start', '09:00'))::TIME;
  v_prof_end   := (COALESCE(v_day_hours->>'close', v_day_hours->>'end',   '20:00'))::TIME;

  IF v_duration_col = 'duration_minutes' THEN
    SELECT array_agg(tsrange(appointment_date AT TIME ZONE p_timezone, (appointment_date AT TIME ZONE p_timezone) + (duration_minutes || ' minutes')::INTERVAL))
    INTO v_busy_ranges FROM appointments WHERE professional_id = p_member_id AND status NOT IN ('cancelled', 'no_show')
    AND (appointment_date AT TIME ZONE p_timezone)::DATE = p_date;
  ELSIF v_duration_col = 'duration' THEN
    SELECT array_agg(tsrange(appointment_date AT TIME ZONE p_timezone, (appointment_date AT TIME ZONE p_timezone) + (duration || ' minutes')::INTERVAL))
    INTO v_busy_ranges FROM appointments WHERE professional_id = p_member_id AND status NOT IN ('cancelled', 'no_show')
    AND (appointment_date AT TIME ZONE p_timezone)::DATE = p_date;
  ELSE
    v_busy_ranges := '{}';
  END IF;

  v_current_slot  := (p_date::TEXT || ' ' || v_prof_start::TEXT)::TIMESTAMP;
  v_effective_end := (p_date::TEXT || ' ' || v_prof_end::TEXT)::TIMESTAMP;
  v_cap_ts := CASE WHEN p_last_slot_cap IS NULL THEN NULL
                   ELSE (p_date::TEXT || ' ' || p_last_slot_cap::TEXT)::TIMESTAMP END;

  LOOP
    -- FIX 2: con cap el límite es el INICIO del slot (la duración puede exceder
    -- el cierre). Sin cap se conserva la condición original.
    IF v_cap_ts IS NOT NULL THEN
      EXIT WHEN v_current_slot > v_cap_ts;
    ELSE
      EXIT WHEN v_current_slot + (p_duration || ' minutes')::INTERVAL > v_effective_end;
    END IF;

    slot_time := v_current_slot::TIME;
    is_available := NOT (COALESCE(v_busy_ranges, '{}') && ARRAY[tsrange(v_current_slot, v_current_slot + (p_duration || ' minutes')::INTERVAL)]);
    RETURN NEXT;

    v_current_slot := v_current_slot + (p_interval || ' minutes')::INTERVAL;
  END LOOP;
END;
$function$;


CREATE OR REPLACE FUNCTION public.check_availability(
  p_clinic_id uuid,
  p_date date,
  p_time time without time zone,
  p_duration integer DEFAULT 60,
  p_last_slot_cap time without time zone DEFAULT NULL
)
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
          p_clinic_id, v_member_id, p_date, p_duration, 30, v_timezone, p_last_slot_cap
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


CREATE OR REPLACE FUNCTION public.get_available_slots(
  p_clinic_id uuid,
  p_date date,
  p_duration integer DEFAULT 60,
  p_timezone text DEFAULT 'America/Santiago'::text,
  p_interval integer DEFAULT 30,
  p_last_slot_cap time without time zone DEFAULT NULL
)
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
  IF EXISTS (SELECT 1 FROM public.clinic_blocked_dates WHERE clinic_id = p_clinic_id AND blocked_date = p_date) THEN
    RETURN;
  END IF;

  SELECT working_hours INTO v_working_hours FROM public.clinic_settings WHERE id = p_clinic_id;
  IF v_working_hours IS NULL THEN RETURN; END IF;

  v_dow := EXTRACT(DOW FROM p_date);
  v_day_name := CASE v_dow
    WHEN 1 THEN 'monday' WHEN 2 THEN 'tuesday' WHEN 3 THEN 'wednesday'
    WHEN 4 THEN 'thursday' WHEN 5 THEN 'friday' WHEN 6 THEN 'saturday'
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
