-- Update get_professional_available_slots to respect clinic_blocked_dates

CREATE OR REPLACE FUNCTION public.get_professional_available_slots(
  p_clinic_id UUID,
  p_member_id UUID,
  p_date DATE,
  p_duration INTEGER DEFAULT 60,
  p_interval INTEGER DEFAULT 30,
  p_timezone TEXT DEFAULT 'America/Santiago'
)
RETURNS TABLE (slot_time TIME, is_available BOOLEAN) AS $$
DECLARE
  v_working_hours JSONB;
  v_day_name TEXT;
  v_prof_start TIME;
  v_prof_end TIME;
  v_current_slot TIMESTAMP;
  v_effective_end TIMESTAMP;
  v_busy_ranges TSRANGE[];
  v_duration_col TEXT;
BEGIN
  -- 0. Verificar si el día está bloqueado manualmente
  IF EXISTS (SELECT 1 FROM public.clinic_blocked_dates WHERE clinic_id = p_clinic_id AND blocked_date = p_date) THEN
    RETURN;
  END IF;

  -- 1. Identify valid duration column
  SELECT column_name INTO v_duration_col
  FROM information_schema.columns 
  WHERE table_name = 'appointments' AND column_name IN ('duration', 'duration_minutes')
  LIMIT 1;

  -- 2. Get Working Hours (with fallback to clinic)
  SELECT COALESCE(working_hours, (SELECT working_hours FROM public.clinic_settings WHERE id = p_clinic_id))
  INTO v_working_hours FROM public.clinic_members WHERE id = p_member_id;

  v_day_name := CASE EXTRACT(DOW FROM p_date)
    WHEN 1 THEN 'monday' WHEN 2 THEN 'tuesday' WHEN 3 THEN 'wednesday'
    WHEN 4 THEN 'thursday' WHEN 5 THEN 'friday' WHEN 6 THEN 'saturday'
    WHEN 0 THEN 'sunday'
  END;

  IF v_working_hours->v_day_name IS NULL THEN RETURN; END IF;

  v_prof_start := (COALESCE(v_working_hours->v_day_name->>'open', v_working_hours->v_day_name->>'start', '09:00'))::TIME;
  v_prof_end := (COALESCE(v_working_hours->v_day_name->>'close', v_working_hours->v_day_name->>'end', '20:00'))::TIME;

  -- 3. Load Busy Ranges (Schema Aware)
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

  -- 4. Generate Slots
  v_current_slot := (p_date::TEXT || ' ' || v_prof_start::TEXT)::TIMESTAMP;
  v_effective_end := (p_date::TEXT || ' ' || v_prof_end::TEXT)::TIMESTAMP;

  WHILE v_current_slot + (p_duration || ' minutes')::INTERVAL <= v_effective_end LOOP
    slot_time := v_current_slot::TIME;
    is_available := NOT (COALESCE(v_busy_ranges, '{}') && ARRAY[tsrange(v_current_slot, v_current_slot + (p_duration || ' minutes')::INTERVAL)]);
    RETURN NEXT;
    v_current_slot := v_current_slot + (p_interval || ' minutes')::INTERVAL;
  END LOOP;
END;
$$ LANGUAGE plpgsql STABLE;
