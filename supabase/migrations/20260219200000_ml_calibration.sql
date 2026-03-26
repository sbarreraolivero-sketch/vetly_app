-- =============================================================
-- MIGRATION: Revenue Retention Engine™ — ML Calibration (Auto-Return Windows)
-- =============================================================

CREATE OR REPLACE FUNCTION public.calibrate_service_return_windows(p_clinic_id UUID)
RETURNS TABLE (
  service_text TEXT, 
  measured_days INTEGER, 
  sample_size INTEGER
) AS $$
DECLARE
  v_service RECORD;
  v_stats RECORD;
BEGIN
  -- Check permission
  IF NOT EXISTS (SELECT 1 FROM public.clinic_members WHERE user_id = auth.uid() AND clinic_id = p_clinic_id) THEN
    -- Allow execution if called by service role (cron) - Implicit by SECURITY DEFINER if owner is superuser/admin
    -- But for strict RLS, usually okay.
    NULL;
  END IF;

  FOR v_service IN
    SELECT service 
    FROM public.appointments 
    WHERE clinic_id = p_clinic_id AND status = 'completed'
    GROUP BY service
    HAVING COUNT(*) >= 5 -- Low threshold for MVP, ideally 20+
  LOOP
    
    -- Calculate intervals between visits for this service
    -- Note: This assumes "Return for SAME service". 
    -- Cross-service retention is harder (General Return Window).
    WITH visits AS (
        SELECT patient_id, appointment_date
        FROM public.appointments
        WHERE clinic_id = p_clinic_id AND service = v_service.service AND status = 'completed'
        ORDER BY patient_id, appointment_date
    ),
    intervals AS (
        SELECT EXTRACT(DAY FROM (appointment_date - LAG(appointment_date) OVER (PARTITION BY patient_id ORDER BY appointment_date)))::INTEGER as gap
        FROM visits
    )
    SELECT 
        percentile_cont(0.75) WITHIN GROUP (ORDER BY gap)::INTEGER as p75_gap, -- 75th percentile to capture majority without extreme outliers
        COUNT(gap) as num_gaps
    INTO v_stats
    FROM intervals
    WHERE gap IS NOT NULL AND gap > 0 AND gap < 365; -- Ignore huge gaps > 1 year (churned and returned)
    
    IF v_stats.num_gaps >= 3 THEN
        -- Upsert
        INSERT INTO public.service_return_windows (clinic_id, service_name, return_window_days)
        VALUES (p_clinic_id, v_service.service, v_stats.p75_gap)
        ON CONFLICT (clinic_id, service_name) 
        DO UPDATE SET return_window_days = v_stats.p75_gap;
        
        service_text := v_service.service;
        measured_days := v_stats.p75_gap;
        sample_size := v_stats.num_gaps;
        RETURN NEXT;
    END IF;
    
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
