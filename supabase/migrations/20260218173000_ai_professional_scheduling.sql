-- Migration: ai_professional_scheduling
-- Description: Adds RPC to get available slots for a specific professional based on their individual working hours.

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
  v_dow INTEGER;
  v_day_name TEXT;
  v_start_time TEXT;
  v_end_time TEXT;
  v_slot_start TIMESTAMP; -- Local timestamp
  v_slot_end TIMESTAMP;   -- Local timestamp
  v_day_start TIMESTAMP;  -- Local timestamp
  v_day_end TIMESTAMP;    -- Local timestamp
  v_busy_ranges TSRANGE[];
  v_slot_range TSRANGE;
  v_is_free BOOLEAN;
  v_range TSRANGE;
  v_admin_role user_role := 'admin';
BEGIN
  -- 1. Get working hours for the professional
  SELECT working_hours INTO v_working_hours
  FROM clinic_members
  WHERE id = p_member_id AND clinic_id = p_clinic_id;

  -- If no working hours defined, or member not found, return empty
  IF v_working_hours IS NULL THEN
    RETURN;
  END IF;

  -- 2. Determine day name (English keys in JSON: monday, tuesday, etc.)
  v_dow := EXTRACT(DOW FROM p_date);
  v_day_name := CASE v_dow
    WHEN 0 THEN 'sunday'
    WHEN 1 THEN 'monday'
    WHEN 2 THEN 'tuesday'
    WHEN 3 THEN 'wednesday'
    WHEN 4 THEN 'thursday'
    WHEN 5 THEN 'friday'
    WHEN 6 THEN 'saturday'
  END;

  -- 3. Check if enabled for this day
  IF (v_working_hours->v_day_name->>'enabled')::BOOLEAN IS NOT TRUE THEN
    RETURN; -- Day not enabled
  END IF;

  -- 4. Parse start/end times (Format "HH:mm")
  v_start_time := v_working_hours->v_day_name->>'start';
  v_end_time := v_working_hours->v_day_name->>'end';

  IF v_start_time IS NULL OR v_end_time IS NULL THEN
    RETURN;
  END IF;

  -- 5. Construct local time boundaries
  -- We cast to TIMESTAMP WITHOUT TIME ZONE to treat as "Wall Clock" time in the requested timezone
  v_day_start := (p_date::TEXT || ' ' || v_start_time || ':00')::TIMESTAMP;
  v_day_end   := (p_date::TEXT || ' ' || v_end_time || ':00')::TIMESTAMP;

  -- 6. Collect busy ranges (existing appointments for this professional)
  -- Appointments are stored in TIMESTAMPTZ (UTC)
  -- We convert them to Local Time (TIMESTAMP) using AT TIME ZONE p_timezone
  SELECT array_agg(
    tsrange(
      (appointment_date AT TIME ZONE p_timezone),
      (appointment_date AT TIME ZONE p_timezone) + (duration || ' minutes')::INTERVAL
    )
  ) INTO v_busy_ranges
  FROM appointments
  WHERE professional_id = p_member_id
    AND status != 'cancelled'
    -- Date filter intersection check is usually safer than strict range, but for "one day" visualization this is fine.
    -- We filter for appointments that overlap with the day's full 24h range in local time.
    AND (appointment_date AT TIME ZONE p_timezone) < ((p_date + 1)::TEXT || ' 00:00:00')::TIMESTAMP
    AND ((appointment_date AT TIME ZONE p_timezone) + (duration || ' minutes')::INTERVAL) > (p_date::TEXT || ' 00:00:00')::TIMESTAMP;

  -- 7. Generate Slots
  v_slot_start := v_day_start;

  WHILE v_slot_start + (p_duration || ' minutes')::INTERVAL <= v_day_end LOOP
    v_slot_end := v_slot_start + (p_duration || ' minutes')::INTERVAL;
    v_slot_range := tsrange(v_slot_start, v_slot_end);

    -- Check is_free
    v_is_free := TRUE;
    
    -- Check overlap with appointments
    IF v_busy_ranges IS NOT NULL THEN
      FOREACH v_range IN ARRAY v_busy_ranges LOOP
        -- && operator checks for overlap
        IF v_range && v_slot_range THEN
          v_is_free := FALSE;
          EXIT; -- Stop checking appointments
        END IF;
      END LOOP;
    END IF;

    -- Return if free
    IF v_is_free THEN
      slot_time := to_char(v_slot_start, 'HH24:MI');
      is_available := TRUE;
      RETURN NEXT;
    END IF;

    -- Move to next interval
    v_slot_start := v_slot_start + (p_interval || ' minutes')::INTERVAL;
  END LOOP;

  RETURN;
END;
$$;
