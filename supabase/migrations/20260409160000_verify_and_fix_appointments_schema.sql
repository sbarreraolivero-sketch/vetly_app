-- Fix for the "column duration does not exist" error
-- This migration will re-create the availability functions using schema-aware logic

CREATE OR REPLACE FUNCTION public.check_availability(
  p_clinic_id UUID,
  p_date DATE,
  p_time TIME,
  p_duration INTEGER DEFAULT 60,
  p_timezone TEXT DEFAULT 'America/Santiago'
)
RETURNS BOOLEAN AS $$
DECLARE
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_conflict_count INTEGER;
  v_working_hours JSONB;
  v_day_name TEXT;
  v_day_hours JSONB;
  v_open_time TIME;
  v_close_time TIME;
  v_duration_col TEXT;
BEGIN
  -- 1. Identify valid duration column
  SELECT column_name INTO v_duration_col
  FROM information_schema.columns 
  WHERE table_name = 'appointments' AND column_name IN ('duration', 'duration_minutes')
  LIMIT 1;

  -- 2. Construct timestamp range
  v_start := (p_date::TEXT || ' ' || p_time::TEXT)::TIMESTAMP AT TIME ZONE p_timezone;
  v_end := v_start + (p_duration || ' minutes')::INTERVAL;
  
  -- 3. Get Working Hours
  SELECT working_hours INTO v_working_hours FROM public.clinic_settings WHERE id = p_clinic_id;
  
  -- 4. Day calculation
  v_day_name := CASE EXTRACT(DOW FROM p_date)
    WHEN 1 THEN 'monday' WHEN 2 THEN 'tuesday' WHEN 3 THEN 'wednesday'
    WHEN 4 THEN 'thursday' WHEN 5 THEN 'friday' WHEN 6 THEN 'saturday'
    WHEN 0 THEN 'sunday'
  END;
  
  v_day_hours := v_working_hours->v_day_name;
  IF v_day_hours IS NULL OR v_day_hours = 'null'::jsonb THEN RETURN FALSE; END IF;
  
  v_open_time := (COALESCE(v_day_hours->>'open', v_day_hours->>'start', '09:00'))::TIME;
  v_close_time := (COALESCE(v_day_hours->>'close', v_day_hours->>'end', '20:00'))::TIME;
  
  IF p_time < v_open_time OR (p_time + (p_duration || ' minutes')::INTERVAL)::TIME > v_close_time THEN
    RETURN FALSE;
  END IF;

  -- 5. Conflict Check (Schema Aware)
  IF v_duration_col = 'duration_minutes' THEN
    SELECT COUNT(*) INTO v_conflict_count FROM public.appointments
    WHERE clinic_id = p_clinic_id AND status NOT IN ('cancelled', 'no_show')
    AND (appointment_date, appointment_date + (duration_minutes || ' minutes')::INTERVAL) OVERLAPS (v_start, v_end);
  ELSIF v_duration_col = 'duration' THEN
    SELECT COUNT(*) INTO v_conflict_count FROM public.appointments
    WHERE clinic_id = p_clinic_id AND status NOT IN ('cancelled', 'no_show')
    AND (appointment_date, appointment_date + (duration || ' minutes')::INTERVAL) OVERLAPS (v_start, v_end);
  ELSE
    -- If no column found, assume success but log? (Very unlikely)
    v_conflict_count := 0;
  END IF;
  
  RETURN v_conflict_count = 0;
END;
$$ LANGUAGE plpgsql STABLE;

-- Update get_professional_available_slots to be schema-aware too
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
