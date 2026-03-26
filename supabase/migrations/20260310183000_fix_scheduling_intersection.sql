-- Migration: fix_professional_scheduling_clinic_intersection
-- Description: Ensures professional availability respects the clinic's global working hours.
-- If the clinic is closed on a specific day, no slots are offered for any professional.
-- Also ensures professional start/end times are bounded by clinic hours.

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
  v_prof_start TEXT;
  v_prof_end TEXT;
  v_clinic_start TEXT;
  v_clinic_end TEXT;
  v_effective_start TIMESTAMP;
  v_effective_end TIMESTAMP;
  v_lunch_start TEXT;
  v_lunch_end TEXT;
  v_lunch_enabled BOOLEAN;
  v_slot_start TIMESTAMP;
  v_slot_end TIMESTAMP;
  v_busy_ranges TSRANGE[];
  v_slot_range TSRANGE;
  v_is_free BOOLEAN;
  v_range TSRANGE;
BEGIN
  -- 1. Get working hours for both member and clinic
  SELECT m.working_hours, c.working_hours INTO v_working_hours, v_clinic_working_hours
  FROM clinic_members m
  JOIN clinic_settings c ON c.id = m.clinic_id
  WHERE m.id = p_member_id AND m.clinic_id = p_clinic_id;

  IF v_working_hours IS NULL OR v_clinic_working_hours IS NULL THEN
    RETURN;
  END IF;

  -- 2. Determine day name
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

  -- 3. CRITICAL: Check Clinic Global Closure
  -- In clinic_settings, a closed day is usually null.
  IF v_clinic_working_hours->v_day_name IS NULL OR v_clinic_working_hours->v_day_name = 'null'::jsonb THEN
    RETURN;
  END IF;
  
  -- Also check for an 'enabled' flag in clinic hours just in case
  IF (v_clinic_working_hours->v_day_name->>'enabled')::BOOLEAN IS FALSE THEN
    RETURN;
  END IF;

  -- 4. Check Professional Closure
  IF (v_working_hours->v_day_name->>'enabled')::BOOLEAN IS NOT TRUE THEN
    RETURN;
  END IF;

  -- 5. Calculate Effective Boundaries (Intersection)
  v_prof_start := v_working_hours->v_day_name->>'start';
  v_prof_end   := v_working_hours->v_day_name->>'end';
  v_clinic_start := v_clinic_working_hours->v_day_name->>'open';
  v_clinic_end   := v_clinic_working_hours->v_day_name->>'close';

  IF v_prof_start IS NULL OR v_prof_end IS NULL OR v_clinic_start IS NULL OR v_clinic_end IS NULL THEN
    RETURN;
  END IF;

  -- Use the LATER of the two start times
  v_effective_start := (p_date::TEXT || ' ' || (CASE WHEN v_prof_start > v_clinic_start THEN v_prof_start ELSE v_clinic_start END) || ':00')::TIMESTAMP;
  -- Use the EARLIER of the two end times
  v_effective_end   := (p_date::TEXT || ' ' || (CASE WHEN v_prof_end < v_clinic_end THEN v_prof_end ELSE v_clinic_end END) || ':00')::TIMESTAMP;

  IF v_effective_start >= v_effective_end THEN
    RETURN;
  END IF;

  -- 6. Collect busy ranges (existing appointments + LUNCH BREAK)
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

  -- Add LUNCH BREAK to busy ranges if enabled
  v_lunch_enabled := (v_working_hours->v_day_name->'lunch_break'->>'enabled')::BOOLEAN;
  IF v_lunch_enabled IS TRUE THEN
    v_lunch_start := v_working_hours->v_day_name->'lunch_break'->>'start';
    v_lunch_end := v_working_hours->v_day_name->'lunch_break'->>'end';
    
    IF v_lunch_start IS NOT NULL AND v_lunch_end IS NOT NULL THEN
        v_busy_ranges := array_append(
            v_busy_ranges, 
            tsrange(
                (p_date::TEXT || ' ' || v_lunch_start || ':00')::TIMESTAMP,
                (p_date::TEXT || ' ' || v_lunch_end || ':00')::TIMESTAMP
            )
        );
    END IF;
  END IF;

  -- 7. Generate Slots
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

    v_slot_start := v_slot_start + (p_interval || ' minutes')::INTERVAL;
  END LOOP;

  RETURN;
END;
$$;
