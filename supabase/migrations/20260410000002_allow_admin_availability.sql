-- Migration: Allow Admins to be considered in check_availability
-- Small clinics often have admins who are also doctors performing services.

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
  
  -- We'll check all active professionals for this clinic who are NOT ONLY receptionists
  -- Including admins because they often perform medical services in smaller clinics
  FOR v_member_id IN (
    SELECT id FROM public.clinic_members 
    WHERE clinic_id = p_clinic_id 
      AND status = 'active' 
      AND role NOT IN ('receptionist')
  ) LOOP
    -- Check if this specific professional has this time slot available
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
