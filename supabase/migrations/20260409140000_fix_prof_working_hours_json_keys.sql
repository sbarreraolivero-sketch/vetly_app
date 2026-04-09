-- Fix the JSON working hours keys for professionals (start/end instead of open/close)
CREATE OR REPLACE FUNCTION public.get_professional_available_slots(
  p_clinic_id UUID,
  p_member_id UUID,
  p_date DATE,
  p_duration INTEGER DEFAULT 60,
  p_interval INTEGER DEFAULT 30,
  p_timezone TEXT DEFAULT 'America/Santiago'
)
RETURNS TABLE (slot_time TEXT, is_available BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_working_hours JSONB;
  v_clinic_working_hours JSONB;
  v_dow INTEGER;
  v_day_name TEXT;
  v_prof_start TIME;
  v_prof_end TIME;
  v_clinic_start TIME;
  v_clinic_end TIME;
  v_effective_start TIMESTAMP;
  v_effective_end TIMESTAMP;
  v_current_slot TIMESTAMP;
  v_slot_end TIMESTAMP;
  v_busy_ranges tsrange[];
  r tsrange;
  v_is_available BOOLEAN;
  v_prof_lunch_start TIME;
  v_prof_lunch_end TIME;
  v_prof_lunch_enabled BOOLEAN := FALSE;
  v_clinic_lunch_start TIME;
  v_clinic_lunch_end TIME;
  v_clinic_lunch_enabled BOOLEAN := FALSE;
BEGIN
  -- 1. Get Clinic Working Hours
  SELECT working_hours INTO v_clinic_working_hours
  FROM public.clinic_settings
  WHERE id = p_clinic_id;

  -- 2. Get Professional Working Hours
  SELECT working_hours INTO v_working_hours
  FROM public.clinic_members
  WHERE id = p_member_id AND clinic_id = p_clinic_id;

  -- FALLBACK: If professional has no working hours, use clinic working hours
  IF v_working_hours IS NULL OR v_working_hours = '{}'::jsonb OR v_working_hours = 'null'::jsonb THEN
    v_working_hours := v_clinic_working_hours;
  END IF;

  IF v_working_hours IS NULL OR v_clinic_working_hours IS NULL THEN
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

  -- Closure checks
  IF v_clinic_working_hours->v_day_name IS NULL 
     OR v_clinic_working_hours->v_day_name = 'null'::jsonb 
     OR (v_clinic_working_hours->v_day_name->>'enabled')::BOOLEAN IS FALSE THEN
    RETURN;
  END IF;

  IF (v_working_hours->v_day_name->>'enabled')::BOOLEAN IS NOT TRUE THEN
    RETURN;
  END IF;

  -- Parse and Intersect (FIXED TO SUPPORT START/END FROM FRONTEND)
  v_prof_start := (COALESCE(v_working_hours->v_day_name->>'open', v_working_hours->v_day_name->>'start'))::TIME;
  v_prof_end   := (COALESCE(v_working_hours->v_day_name->>'close', v_working_hours->v_day_name->>'end'))::TIME;
  v_clinic_start := (COALESCE(v_clinic_working_hours->v_day_name->>'open', v_clinic_working_hours->v_day_name->>'start', '00:00'))::TIME;
  v_clinic_end   := (COALESCE(v_clinic_working_hours->v_day_name->>'close', v_clinic_working_hours->v_day_name->>'end', '23:59'))::TIME;

  -- Base check: Does the requested day intersect with today?
  -- Compare using local time strictly without timezones to avoid crossing days
  IF (p_date::TEXT || ' 00:00:00')::TIMESTAMP < (CURRENT_DATE::TEXT || ' 00:00:00')::TIMESTAMP THEN
    RETURN;
  END IF;

  -- Determine effective shift bounds considering both clinic and professional constraints
  v_effective_start := (p_date::TEXT || ' ' || (CASE WHEN v_prof_start > v_clinic_start THEN v_prof_start ELSE v_clinic_start END)::TEXT)::TIMESTAMP;
  v_effective_end   := (p_date::TEXT || ' ' || (CASE WHEN v_prof_end < v_clinic_end THEN v_prof_end ELSE v_clinic_end END)::TEXT)::TIMESTAMP;

  IF p_date = CURRENT_DATE THEN
    -- If booking today, don't return slots in the past
    -- We convert CURRENT_TIME to the clinic's local timezone
    IF v_effective_start < (CURRENT_TIMESTAMP AT TIME ZONE p_timezone) THEN
      v_effective_start := date_trunc('minute', CURRENT_TIMESTAMP AT TIME ZONE p_timezone);
    END IF;
  END IF;

  IF v_effective_start >= v_effective_end THEN
    RETURN;
  END IF;

  -- Collect busy ranges
  SELECT array_agg(
    tsrange(
      (appointment_date AT TIME ZONE p_timezone),
      (appointment_date AT TIME ZONE p_timezone) + (duration || ' minutes')::INTERVAL
    )
  ) INTO v_busy_ranges
  FROM appointments
  WHERE professional_id = p_member_id
    AND status != 'cancelled'
    AND (appointment_date AT TIME ZONE p_timezone) >= (p_date::TEXT || ' 00:00:00')::TIMESTAMP
    AND (appointment_date AT TIME ZONE p_timezone) < ((p_date + 1)::TEXT || ' 00:00:00')::TIMESTAMP;

  IF v_busy_ranges IS NULL THEN
    v_busy_ranges := '{}'::tsrange[];
  END IF;

  -- Parse lunch breaks
  -- Professional Lunch
  IF (v_working_hours->v_day_name->'lunch_break'->>'enabled')::BOOLEAN IS TRUE THEN
    v_prof_lunch_enabled := TRUE;
    v_prof_lunch_start := (COALESCE(v_working_hours->v_day_name->'lunch_break'->>'start', v_working_hours->v_day_name->'lunch_break'->>'open'))::TIME;
    v_prof_lunch_end   := (COALESCE(v_working_hours->v_day_name->'lunch_break'->>'end', v_working_hours->v_day_name->'lunch_break'->>'close'))::TIME;
  END IF;

  -- Clinic Lunch
  IF (v_clinic_working_hours->v_day_name->'lunch_break'->>'enabled')::BOOLEAN IS TRUE THEN
    v_clinic_lunch_enabled := TRUE;
    v_clinic_lunch_start := (COALESCE(v_clinic_working_hours->v_day_name->'lunch_break'->>'start', v_clinic_working_hours->v_day_name->'lunch_break'->>'open'))::TIME;
    v_clinic_lunch_end   := (COALESCE(v_clinic_working_hours->v_day_name->'lunch_break'->>'end', v_clinic_working_hours->v_day_name->'lunch_break'->>'close'))::TIME;
  END IF;

  -- Generate discrete intervals of size p_interval
  v_current_slot := v_effective_start;
  WHILE v_current_slot + (p_duration || ' minutes')::INTERVAL <= v_effective_end LOOP
    v_is_available := TRUE;
    v_slot_end := v_current_slot + (p_duration || ' minutes')::INTERVAL;

    -- Check intersections
    FOREACH r IN ARRAY v_busy_ranges LOOP
      IF tsrange(v_current_slot, v_slot_end, '()') && r THEN
        v_is_available := FALSE;
        EXIT;
      END IF;
    END LOOP;

    -- Check Lunch Breaks
    IF v_prof_lunch_enabled THEN
      IF (v_current_slot::TIME < v_prof_lunch_end) AND (v_slot_end::TIME > v_prof_lunch_start) THEN
        v_is_available := FALSE;
      END IF;
    END IF;

    IF v_clinic_lunch_enabled THEN
      IF (v_current_slot::TIME < v_clinic_lunch_end) AND (v_slot_end::TIME > v_clinic_lunch_start) THEN
        v_is_available := FALSE;
      END IF;
    END IF;

    IF v_is_available THEN
      slot_time := to_char(v_current_slot, 'HH24:MI');
      is_available := TRUE;
      RETURN NEXT;
    END IF;

    v_current_slot := v_current_slot + (p_interval || ' minutes')::INTERVAL;
  END LOOP;

  RETURN;
END;
$$;
