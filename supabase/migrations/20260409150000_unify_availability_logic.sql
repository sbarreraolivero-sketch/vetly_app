-- Unify global availability check with professional availability logic
-- Handles both start/end and open/close JSON keys

CREATE OR REPLACE FUNCTION public.check_availability(
  p_clinic_id UUID,
  p_date DATE,
  p_time TIME,
  p_duration INTEGER DEFAULT 60
)
RETURNS BOOLEAN AS $$
DECLARE
  v_timezone TEXT;
  v_any_prof_free BOOLEAN := FALSE;
  v_member_id UUID;
BEGIN
  -- Get timezone from clinic settings
  SELECT timezone INTO v_timezone FROM public.clinic_settings WHERE id = p_clinic_id;
  IF v_timezone IS NULL THEN v_timezone := 'America/Santiago'; END IF;
  
  -- We'll check all active professionals for this clinic who are NOT receptionists
  FOR v_member_id IN (
    SELECT id FROM public.clinic_members 
    WHERE clinic_id = p_clinic_id 
      AND status = 'active' 
      AND role NOT IN ('receptionist', 'admin')
  ) LOOP
    -- Check if this specific professional has this time slot available
    -- We use a 30-min interval internally for the availability check
    IF EXISTS (
        SELECT 1 FROM public.get_professional_available_slots(
          p_clinic_id, 
          v_member_id, 
          p_date, 
          p_duration, 
          30, 
          v_timezone
        )
        WHERE slot_time = to_char(p_time, 'HH24:MI') AND is_available = TRUE
    ) THEN
        v_any_prof_free := TRUE;
        EXIT;
    END IF;
  END LOOP;

  RETURN v_any_prof_free;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Update get_available_slots to be robust and use the fixed check_availability
CREATE OR REPLACE FUNCTION public.get_available_slots(
  p_clinic_id UUID,
  p_date DATE,
  p_duration INTEGER DEFAULT 60,
  p_timezone TEXT DEFAULT 'America/Santiago',
  p_interval INTEGER DEFAULT 30
)
RETURNS TABLE (slot_time TIME, is_available BOOLEAN) AS $$
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
  
  -- Clinic closure check
  IF v_day_hours IS NULL OR v_day_hours = 'null'::jsonb OR (v_day_hours->>'enabled')::BOOLEAN IS FALSE THEN
    RETURN;
  END IF;
  
  -- Support both open/close and start/end keys
  v_open_time := (COALESCE(v_day_hours->>'open', v_day_hours->>'start', '09:00'))::TIME;
  v_close_time := (COALESCE(v_day_hours->>'close', v_day_hours->>'end', '20:00'))::TIME;
  
  -- If searching for today, start from now
  IF p_date = CURRENT_DATE THEN
    v_current_time := (CURRENT_TIMESTAMP AT TIME ZONE p_timezone)::TIME;
    IF v_current_time < v_open_time THEN
        v_current_time := v_open_time;
    END IF;
  ELSE
    v_current_time := v_open_time;
  END IF;
  
  -- Loop through slots
  WHILE v_current_time + (p_duration || ' minutes')::INTERVAL <= v_close_time LOOP
    slot_time := v_current_time;
    is_available := public.check_availability(p_clinic_id, p_date, v_current_time, p_duration);
    
    -- We only return slots that are actually available
    -- But we check every p_interval minutes
    IF is_available THEN
        RETURN NEXT;
    END IF;
    
    v_current_time := v_current_time + (p_interval || ' minutes')::INTERVAL;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
