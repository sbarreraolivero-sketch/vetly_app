-- Migration: add_lunch_break_to_scheduling
-- Description: Updates availability RPCs to respect a lunch break and uses a safer DOW calculation.

-- 1. Update check_availability (Global Clinic check)
CREATE OR REPLACE FUNCTION public.check_availability(
  p_clinic_id UUID,
  p_date DATE,
  p_time TIME,
  p_duration INTEGER DEFAULT 60
)
RETURNS BOOLEAN AS $$
DECLARE
  v_working_hours JSONB;
  v_dow INTEGER;
  v_day_name TEXT;
  v_day_hours JSONB;
  v_open_time TIME;
  v_close_time TIME;
  v_lunch_start TIME;
  v_lunch_end TIME;
  v_lunch_enabled BOOLEAN;
  v_conflict_count INTEGER;
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_timezone TEXT;
BEGIN
  -- Get clinic settings
  SELECT working_hours, timezone INTO v_working_hours, v_timezone
  FROM public.clinic_settings
  WHERE id = p_clinic_id;
  
  -- Safer Day calculation
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
  IF v_day_hours IS NULL OR v_day_hours = 'null'::jsonb THEN
    RETURN FALSE;
  END IF;
  
  v_open_time := (v_day_hours->>'open')::TIME;
  v_close_time := (v_day_hours->>'close')::TIME;
  
  -- Lunch Break check
  v_lunch_enabled := (v_day_hours->'lunch_break'->>'enabled')::BOOLEAN;
  IF v_lunch_enabled IS TRUE THEN
    v_lunch_start := (v_day_hours->'lunch_break'->>'start')::TIME;
    v_lunch_end := (v_day_hours->'lunch_break'->>'end')::TIME;
    
    -- Check if appointment overlaps with lunch
    -- If appointment starts BEFORE lunch ends AND ends AFTER lunch starts -> Conflict
    IF p_time < v_lunch_end AND (p_time + (p_duration || ' minutes')::INTERVAL)::TIME > v_lunch_start THEN
        RETURN FALSE;
    END IF;
  END IF;
  
  -- General hours check
  IF p_time < v_open_time OR (p_time + (p_duration || ' minutes')::INTERVAL)::TIME > v_close_time THEN
    RETURN FALSE;
  END IF;
  
  -- Conflict check with existing appointments
  v_start := (p_date::TEXT || ' ' || p_time::TEXT)::TIMESTAMP AT TIME ZONE v_timezone;
  v_end := v_start + (p_duration || ' minutes')::INTERVAL;
  
  SELECT COUNT(*) INTO v_conflict_count
  FROM public.appointments
  WHERE clinic_id = p_clinic_id
    AND status NOT IN ('cancelled', 'no_show')
    AND (
      (appointment_date, appointment_date + (duration || ' minutes')::INTERVAL)
      OVERLAPS
      (v_start, v_end)
    );
    
  RETURN v_conflict_count = 0;
END;
$$ LANGUAGE plpgsql;

-- 2. Update get_available_slots (Global Clinic Slots)
-- This function relies on check_availability, so we just need to fix its DOW logic
CREATE OR REPLACE FUNCTION public.get_available_slots(
  p_clinic_id UUID,
  p_date DATE,
  p_duration INTEGER DEFAULT 60
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
  IF v_day_hours IS NULL OR v_day_hours = 'null'::jsonb THEN
    RETURN;
  END IF;
  
  v_open_time := (v_day_hours->>'open')::TIME;
  v_close_time := (v_day_hours->>'close')::TIME;
  v_current_time := v_open_time;
  
  WHILE v_current_time + (p_duration || ' minutes')::INTERVAL <= v_close_time LOOP
    slot_time := v_current_time;
    is_available := public.check_availability(p_clinic_id, p_date, v_current_time, p_duration);
    RETURN NEXT;
    v_current_time := v_current_time + '30 minutes'::INTERVAL;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- 3. Update get_professional_available_slots (Professional Slots)
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
  v_lunch_start TEXT;
  v_lunch_end TEXT;
  v_lunch_enabled BOOLEAN;
  v_slot_start TIMESTAMP;
  v_slot_end TIMESTAMP;
  v_day_start TIMESTAMP;
  v_day_end TIMESTAMP;
  v_busy_ranges TSRANGE[];
  v_slot_range TSRANGE;
  v_is_free BOOLEAN;
  v_range TSRANGE;
BEGIN
  -- 1. Get working hours
  SELECT working_hours INTO v_working_hours
  FROM clinic_members
  WHERE id = p_member_id AND clinic_id = p_clinic_id;

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

  IF (v_working_hours->v_day_name->>'enabled')::BOOLEAN IS NOT TRUE THEN
    RETURN;
  END IF;

  v_start_time := v_working_hours->v_day_name->>'start';
  v_end_time := v_working_hours->v_day_name->>'end';

  IF v_start_time IS NULL OR v_end_time IS NULL THEN
    RETURN;
  END IF;

  v_day_start := (p_date::TEXT || ' ' || v_start_time || ':00')::TIMESTAMP;
  v_day_end   := (p_date::TEXT || ' ' || v_end_time || ':00')::TIMESTAMP;

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
  v_slot_start := v_day_start;

  WHILE v_slot_start + (p_duration || ' minutes')::INTERVAL <= v_day_end LOOP
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
