-- Migración: Crear tabla de días bloqueados y actualizar lógica de disponibilidad
-- Fecha: 2026-04-15

-- 1. Crear la tabla clinic_blocked_dates
CREATE TABLE IF NOT EXISTS public.clinic_blocked_dates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
    blocked_date DATE NOT NULL,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    UNIQUE(clinic_id, blocked_date)
);

-- 2. Habilitar RLS
ALTER TABLE public.clinic_blocked_dates ENABLE ROW LEVEL SECURITY;

-- 3. Políticas de seguridad
CREATE POLICY "Allow members to view blocked dates"
    ON public.clinic_blocked_dates FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM public.clinic_members 
        WHERE user_id = auth.uid() 
        AND clinic_id = public.clinic_blocked_dates.clinic_id
      )
    );

CREATE POLICY "Allow admins to manage blocked dates"
    ON public.clinic_blocked_dates FOR ALL
    USING (public.is_clinic_admin(clinic_id))
    WITH CHECK (public.is_clinic_admin(clinic_id));

-- 4. Actualizar get_available_slots para ignorar días bloqueados
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
  -- Verificar si el día está bloqueado manualmente
  IF EXISTS (SELECT 1 FROM public.clinic_blocked_dates WHERE clinic_id = p_clinic_id AND blocked_date = p_date) THEN
    RETURN;
  END IF;

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

-- 5. También actualizar check_availability por seguridad redundante
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
  -- Verificar si el día está bloqueado manualmente
  IF EXISTS (SELECT 1 FROM public.clinic_blocked_dates WHERE clinic_id = p_clinic_id AND blocked_date = p_date) THEN
    RETURN FALSE;
  END IF;

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
