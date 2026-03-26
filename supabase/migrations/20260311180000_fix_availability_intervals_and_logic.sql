-- Migration: fix_availability_and_intervals
-- Description: 
-- 1. Restore 30-minute interval in global availability check to provide more starting options.
-- 2. Improve global availability check to return TRUE if AT LEAST ONE professional is free.
-- 3. Ensure professional availability consistently uses the requested interval.

-- 1. Improve check_availability to be "Any Professional Available"
CREATE OR REPLACE FUNCTION public.check_availability(
  p_clinic_id UUID,
  p_date DATE,
  p_time TIME,
  p_duration INTEGER DEFAULT 60
)
RETURNS BOOLEAN AS $$
DECLARE
  v_timezone TEXT;
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_any_prof_free BOOLEAN := FALSE;
  v_member_id UUID;
BEGIN
  -- Get timezone
  SELECT timezone INTO v_timezone FROM public.clinic_settings WHERE id = p_clinic_id;
  
  -- Calculate range
  v_start := (p_date::TEXT || ' ' || p_time::TEXT)::TIMESTAMP AT TIME ZONE v_timezone;
  v_end := v_start + (p_duration || ' minutes')::INTERVAL;

  -- Logic: A slot is available globally if there exists at least one professional 
  -- who is NOT busy AND whose working hours cover this time.
  
  -- We'll check all active professionals for this clinic
  FOR v_member_id IN (
    SELECT id FROM public.clinic_members 
    WHERE clinic_id = p_clinic_id AND status = 'active' AND role != 'receptionist'
  ) LOOP
    -- If get_professional_available_slots returns this specific time is_available = true
    -- note: we use a limited check here for performance
    IF EXISTS (
        SELECT 1 FROM public.get_professional_available_slots(p_clinic_id, v_member_id, p_date, p_duration, 30, v_timezone)
        WHERE slot_time = to_char(p_time, 'HH24:MI') AND is_available = TRUE
    ) THEN
        v_any_prof_free := TRUE;
        EXIT;
    END IF;
  END LOOP;

  RETURN v_any_prof_free;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Fix get_available_slots to use fixed 30-min interval
CREATE OR REPLACE FUNCTION public.get_available_slots(
  p_clinic_id UUID,
  p_date DATE,
  p_duration INTEGER DEFAULT 60,
  p_timezone TEXT DEFAULT 'America/Santiago',
  p_interval INTEGER DEFAULT 30
)
RETURNS TABLE(slot_time TIME, is_available BOOLEAN) AS $$
DECLARE
  v_working_hours JSONB;
  v_dow INTEGER;
  v_day_name TEXT;
  v_day_hours JSONB;
  v_open_time TIME;
  v_close_time TIME;
  v_current_time TIME;
BEGIN
  SELECT working_hours INTO v_working_hours
  FROM public.clinic_settings
  WHERE id = p_clinic_id;
  
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
  
  -- Clinic closure check
  IF v_day_hours IS NULL OR v_day_hours = 'null'::jsonb OR (v_day_hours->>'enabled')::BOOLEAN IS FALSE THEN
    RETURN;
  END IF;
  
  v_open_time := (COALESCE(v_day_hours->>'open', v_day_hours->>'start', '09:00'))::TIME;
  v_close_time := (COALESCE(v_day_hours->>'close', v_day_hours->>'end', '20:00'))::TIME;
  v_current_time := v_open_time;
  
  WHILE v_current_time + (p_duration || ' minutes')::INTERVAL <= v_close_time LOOP
    slot_time := v_current_time;
    is_available := public.check_availability(p_clinic_id, p_date, v_current_time, p_duration);
    
    IF is_available THEN
        RETURN NEXT;
    END IF;
    
    -- ALWAYS move by interval to give more options
    v_current_time := v_current_time + (p_interval || ' minutes')::INTERVAL;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- 3. Ensure Professional RPC also uses the loop correctly
CREATE OR REPLACE FUNCTION get_professional_available_slots(
  p_clinic_id UUID,
  p_member_id UUID,
  p_date DATE,
  p_duration INTEGER,
  p_interval INTEGER DEFAULT 30,
  p_timezone TEXT DEFAULT 'America/Santiago'
)
RETURNS TABLE (
  slot_time TEXT,
  is_available BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
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
  v_lunch_start TIME;
  v_lunch_end TIME;
  v_lunch_enabled BOOLEAN;
  v_slot_start TIMESTAMP;
  v_slot_end TIMESTAMP;
  v_busy_ranges TSRANGE[];
  v_slot_range TSRANGE;
  v_is_free BOOLEAN;
  v_range TSRANGE;
BEGIN
  -- Get both sets of hours
  SELECT m.working_hours, c.working_hours INTO v_working_hours, v_clinic_working_hours
  FROM clinic_members m
  JOIN clinic_settings c ON c.id = m.clinic_id
  WHERE m.id = p_member_id AND m.clinic_id = p_clinic_id;

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

  -- Parse and Intersect
  v_prof_start := (v_working_hours->v_day_name->>'open')::TIME;
  v_prof_end   := (v_working_hours->v_day_name->>'close')::TIME;
  v_clinic_start := (COALESCE(v_clinic_working_hours->v_day_name->>'open', v_clinic_working_hours->v_day_name->>'start', '00:00'))::TIME;
  v_clinic_end   := (COALESCE(v_clinic_working_hours->v_day_name->>'close', v_clinic_working_hours->v_day_name->>'end', '23:59'))::TIME;

  v_effective_start := (p_date::TEXT || ' ' || (CASE WHEN v_prof_start > v_clinic_start THEN v_prof_start ELSE v_clinic_start END)::TEXT)::TIMESTAMP;
  v_effective_end   := (p_date::TEXT || ' ' || (CASE WHEN v_prof_end < v_clinic_end THEN v_prof_end ELSE v_clinic_end END)::TEXT)::TIMESTAMP;

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
    AND (appointment_date AT TIME ZONE p_timezone) < ((p_date + 1)::TEXT || ' 00:00:00')::TIMESTAMP
    AND ((appointment_date AT TIME ZONE p_timezone) + (duration || ' minutes')::INTERVAL) > (p_date::TEXT || ' 00:00:00')::TIMESTAMP;

  -- Clinic Lunch Break intersection
  v_lunch_enabled := (v_clinic_working_hours->v_day_name->'lunch_break'->>'enabled')::BOOLEAN;
  IF v_lunch_enabled IS TRUE THEN
    v_lunch_start := (v_clinic_working_hours->v_day_name->'lunch_break'->>'start')::TIME;
    v_lunch_end := (v_clinic_working_hours->v_day_name->'lunch_break'->>'end')::TIME;
    
    IF v_lunch_start IS NOT NULL AND v_lunch_end IS NOT NULL THEN
        v_busy_ranges := array_append(
            v_busy_ranges, 
            tsrange(
                (p_date::TEXT || ' ' || v_lunch_start::TEXT)::TIMESTAMP,
                (p_date::TEXT || ' ' || v_lunch_end::TEXT)::TIMESTAMP
            )
        );
    END IF;
  END IF;

  -- Professional Lunch Break intersection (if defined specifically)
  v_lunch_enabled := (v_working_hours->v_day_name->'lunch_break'->>'enabled')::BOOLEAN;
  IF v_lunch_enabled IS TRUE THEN
    v_lunch_start := (v_working_hours->v_day_name->'lunch_break'->>'start')::TIME;
    v_lunch_end := (v_working_hours->v_day_name->'lunch_break'->>'end')::TIME;
    
    IF v_lunch_start IS NOT NULL AND v_lunch_end IS NOT NULL THEN
        v_busy_ranges := array_append(
            v_busy_ranges, 
            tsrange(
                (p_date::TEXT || ' ' || v_lunch_start::TEXT)::TIMESTAMP,
                (p_date::TEXT || ' ' || v_lunch_end::TEXT)::TIMESTAMP
            )
        );
    END IF;
  END IF;

  -- Generate Slots
  v_slot_start := v_effective_start;
  WHILE v_slot_start + (p_duration || ' minutes')::INTERVAL <= v_effective_end LOOP
    v_slot_end := v_slot_start + (p_duration || ' minutes')::INTERVAL;
    v_slot_range := tsrange(v_slot_start, v_slot_end);
    v_is_free := TRUE;
    
    IF v_busy_ranges IS NOT NULL THEN
      FOREACH v_range IN ARRAY v_busy_ranges LOOP
        IF v_range && v_slot_range THEN
          v_is_free := FALSE;
          EXIT;
        END IF;
      END LOOP;
    END IF;

    IF v_is_free THEN
      slot_time := to_char(v_slot_start, 'HH24:MI');
      is_available := TRUE;
      RETURN NEXT;
    END IF;

    -- ALWAYS move by p_interval
    v_slot_start := v_slot_start + (p_interval || ' minutes')::INTERVAL;
  END LOOP;
END;
$$;
