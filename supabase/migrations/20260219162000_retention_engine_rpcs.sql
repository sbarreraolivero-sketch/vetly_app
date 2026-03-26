-- =============================================================
-- MIGRATION: Revenue Retention Engine™ — RPCs
-- =============================================================

-- 1. Calculate retention score for a single patient
CREATE OR REPLACE FUNCTION public.calculate_patient_retention_score(
  p_clinic_id UUID,
  p_patient_id UUID
)
RETURNS TABLE (
  score INTEGER,
  risk_level TEXT,
  days_since_last_visit INTEGER,
  expected_return_days INTEGER,
  delay_days INTEGER,
  avg_ticket NUMERIC,
  total_visits INTEGER,
  cancellation_count INTEGER,
  no_show_count INTEGER,
  is_vip BOOLEAN,
  frequency_irregular BOOLEAN,
  high_ticket BOOLEAN,
  last_service TEXT,
  last_visit_date DATE,
  assigned_professional TEXT
) AS $$
DECLARE
  v_last_visit DATE;
  v_last_service TEXT;
  v_last_professional TEXT;
  v_days_since INTEGER;
  v_erw INTEGER;
  v_delay INTEGER;
  v_total_visits INTEGER;
  v_cancellations INTEGER;
  v_no_shows INTEGER;
  v_avg_ticket NUMERIC;
  v_clinic_avg_ticket NUMERIC;
  v_score_base NUMERIC;
  v_final_score INTEGER;
  v_is_vip BOOLEAN;
  v_irregular BOOLEAN;
  v_high_ticket BOOLEAN;
  v_risk TEXT;
  v_visit_intervals NUMERIC[];
  v_std_dev NUMERIC;
BEGIN
  -- Get last completed visit
  SELECT
    a.appointment_date::DATE,
    a.service,
    a.notes
  INTO v_last_visit, v_last_service, v_last_professional
  FROM public.appointments a
  WHERE a.patient_id = p_patient_id
    AND a.clinic_id = p_clinic_id
    AND a.status IN ('completed', 'confirmed', 'pending')
  ORDER BY a.appointment_date DESC
  LIMIT 1;

  IF v_last_visit IS NULL THEN
    score := 0; risk_level := 'low'; days_since_last_visit := 0;
    expected_return_days := 30; delay_days := 0; avg_ticket := 0;
    total_visits := 0; cancellation_count := 0; no_show_count := 0;
    is_vip := false; frequency_irregular := false; high_ticket := false;
    last_service := NULL; last_visit_date := NULL; assigned_professional := NULL;
    RETURN NEXT; RETURN;
  END IF;

  v_days_since := CURRENT_DATE - v_last_visit;

  SELECT srw.return_window_days INTO v_erw
  FROM public.service_return_windows srw
  WHERE srw.clinic_id = p_clinic_id AND srw.service_name = v_last_service;
  IF v_erw IS NULL THEN v_erw := 30; END IF;

  v_delay := v_days_since - v_erw;

  SELECT COUNT(*) INTO v_total_visits
  FROM public.appointments WHERE patient_id = p_patient_id AND clinic_id = p_clinic_id AND status NOT IN ('cancelled');

  SELECT COUNT(*) INTO v_cancellations
  FROM public.appointments WHERE patient_id = p_patient_id AND clinic_id = p_clinic_id AND status = 'cancelled';

  SELECT COUNT(*) INTO v_no_shows
  FROM public.appointments WHERE patient_id = p_patient_id AND clinic_id = p_clinic_id AND status = 'no_show';

  SELECT COALESCE(AVG(a.price), 0) INTO v_avg_ticket
  FROM public.appointments a WHERE a.patient_id = p_patient_id AND a.clinic_id = p_clinic_id AND a.price IS NOT NULL AND a.price > 0;

  SELECT COALESCE(AVG(a.price), 0) INTO v_clinic_avg_ticket
  FROM public.appointments a WHERE a.clinic_id = p_clinic_id AND a.price IS NOT NULL AND a.price > 0;

  v_is_vip := (v_total_visits >= 8);
  v_high_ticket := (v_avg_ticket > v_clinic_avg_ticket * 1.5);

  v_irregular := false;
  IF v_total_visits >= 3 THEN
    WITH visit_dates AS (
      SELECT appointment_date::DATE as vd FROM public.appointments
      WHERE patient_id = p_patient_id AND clinic_id = p_clinic_id AND status NOT IN ('cancelled')
      ORDER BY appointment_date
    ),
    intervals AS (SELECT vd - LAG(vd) OVER (ORDER BY vd) as gap FROM visit_dates)
    SELECT COALESCE(STDDEV(gap), 0) INTO v_std_dev FROM intervals WHERE gap IS NOT NULL;
    IF v_std_dev > v_erw * 0.5 THEN v_irregular := true; END IF;
  END IF;

  -- Scoring formula
  IF v_delay <= 0 THEN v_score_base := 0;
  ELSE v_score_base := (v_delay::NUMERIC / GREATEST(v_erw, 1)) * 50; END IF;

  IF v_cancellations >= 2 THEN v_score_base := v_score_base + 10; END IF;
  IF v_no_shows >= 1 THEN v_score_base := v_score_base + 10; END IF;
  IF v_irregular THEN v_score_base := v_score_base + 5; END IF;
  IF v_high_ticket THEN v_score_base := v_score_base + 5; END IF;
  IF v_is_vip THEN v_score_base := v_score_base - 5; END IF;

  v_final_score := GREATEST(0, LEAST(100, v_score_base::INTEGER));

  v_risk := CASE
    WHEN v_final_score <= 40 THEN 'low'
    WHEN v_final_score <= 70 THEN 'medium'
    ELSE 'high'
  END;

  score := v_final_score; risk_level := v_risk;
  days_since_last_visit := v_days_since; expected_return_days := v_erw;
  delay_days := v_delay; avg_ticket := v_avg_ticket;
  total_visits := v_total_visits; cancellation_count := v_cancellations;
  no_show_count := v_no_shows; is_vip := v_is_vip;
  frequency_irregular := v_irregular; high_ticket := v_high_ticket;
  last_service := v_last_service; last_visit_date := v_last_visit;
  assigned_professional := v_last_professional;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Batch compute all scores for a clinic
CREATE OR REPLACE FUNCTION public.compute_clinic_retention_scores(p_clinic_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_patient RECORD;
  v_result RECORD;
  v_count INTEGER := 0;
  v_previous_risk TEXT;
BEGIN
  FOR v_patient IN
    SELECT DISTINCT p.id as patient_id
    FROM public.patients p
    JOIN public.appointments a ON a.patient_id = p.id
    WHERE p.clinic_id = p_clinic_id
  LOOP
    SELECT prs.risk_level INTO v_previous_risk
    FROM public.patient_retention_scores prs
    WHERE prs.patient_id = v_patient.patient_id AND prs.clinic_id = p_clinic_id;

    SELECT * INTO v_result
    FROM public.calculate_patient_retention_score(p_clinic_id, v_patient.patient_id);

    INSERT INTO public.patient_retention_scores (
      clinic_id, patient_id, score, risk_level,
      days_since_last_visit, expected_return_days, delay_days,
      avg_ticket, total_visits, cancellation_count, no_show_count,
      is_vip, frequency_irregular, high_ticket,
      last_service, last_visit_date, assigned_professional,
      computed_at, previous_risk_level
    ) VALUES (
      p_clinic_id, v_patient.patient_id, v_result.score, v_result.risk_level,
      v_result.days_since_last_visit, v_result.expected_return_days, v_result.delay_days,
      v_result.avg_ticket, v_result.total_visits, v_result.cancellation_count, v_result.no_show_count,
      v_result.is_vip, v_result.frequency_irregular, v_result.high_ticket,
      v_result.last_service, v_result.last_visit_date, v_result.assigned_professional,
      NOW(), v_previous_risk
    )
    ON CONFLICT (clinic_id, patient_id) DO UPDATE SET
      score = EXCLUDED.score, risk_level = EXCLUDED.risk_level,
      days_since_last_visit = EXCLUDED.days_since_last_visit,
      expected_return_days = EXCLUDED.expected_return_days,
      delay_days = EXCLUDED.delay_days, avg_ticket = EXCLUDED.avg_ticket,
      total_visits = EXCLUDED.total_visits, cancellation_count = EXCLUDED.cancellation_count,
      no_show_count = EXCLUDED.no_show_count, is_vip = EXCLUDED.is_vip,
      frequency_irregular = EXCLUDED.frequency_irregular, high_ticket = EXCLUDED.high_ticket,
      last_service = EXCLUDED.last_service, last_visit_date = EXCLUDED.last_visit_date,
      assigned_professional = EXCLUDED.assigned_professional,
      computed_at = EXCLUDED.computed_at, previous_risk_level = EXCLUDED.previous_risk_level;

    INSERT INTO public.retention_score_history (clinic_id, patient_id, score, risk_level)
    VALUES (p_clinic_id, v_patient.patient_id, v_result.score, v_result.risk_level);

    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Dashboard stats RPC
CREATE OR REPLACE FUNCTION public.get_retention_dashboard_stats(p_clinic_id UUID)
RETURNS TABLE (
  total_patients INTEGER, patients_low INTEGER, patients_medium INTEGER,
  patients_high INTEGER, revenue_at_risk NUMERIC, revenue_recoverable NUMERIC,
  revenue_recovered_month NUMERIC, avg_score NUMERIC, last_computed_at TIMESTAMPTZ
) AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.clinic_members
    WHERE user_id = auth.uid() AND clinic_id = p_clinic_id AND status = 'active'
  ) THEN RAISE EXCEPTION 'Access denied.'; END IF;

  RETURN QUERY
  SELECT
    COUNT(*)::INTEGER,
    COUNT(*) FILTER (WHERE prs.risk_level = 'low')::INTEGER,
    COUNT(*) FILTER (WHERE prs.risk_level = 'medium')::INTEGER,
    COUNT(*) FILTER (WHERE prs.risk_level = 'high')::INTEGER,
    COALESCE(SUM(prs.avg_ticket) FILTER (WHERE prs.risk_level = 'high'), 0),
    COALESCE(SUM(prs.avg_ticket) FILTER (WHERE prs.risk_level IN ('medium', 'high')), 0),
    COALESCE(
      (SELECT SUM(aal.result_revenue) FROM public.ai_action_log aal
       WHERE aal.clinic_id = p_clinic_id AND aal.result = 'rescheduled'
         AND aal.executed_at >= date_trunc('month', CURRENT_DATE)), 0),
    COALESCE(AVG(prs.score), 0),
    MAX(prs.computed_at)
  FROM public.patient_retention_scores prs WHERE prs.clinic_id = p_clinic_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Get patients at risk
CREATE OR REPLACE FUNCTION public.get_patients_at_risk(
  p_clinic_id UUID, p_risk_level TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50, p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  patient_id UUID, patient_name TEXT, phone_number TEXT,
  score INTEGER, risk_level TEXT, days_since_last_visit INTEGER,
  delay_days INTEGER, last_service TEXT, last_visit_date DATE,
  avg_ticket NUMERIC, total_visits INTEGER, cancellation_count INTEGER, is_vip BOOLEAN
) AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.clinic_members
    WHERE user_id = auth.uid() AND clinic_id = p_clinic_id AND status = 'active'
  ) THEN RAISE EXCEPTION 'Access denied.'; END IF;

  RETURN QUERY
  SELECT prs.patient_id, p.name, p.phone_number, prs.score, prs.risk_level,
    prs.days_since_last_visit, prs.delay_days, prs.last_service, prs.last_visit_date,
    prs.avg_ticket, prs.total_visits, prs.cancellation_count, prs.is_vip
  FROM public.patient_retention_scores prs
  JOIN public.patients p ON p.id = prs.patient_id
  WHERE prs.clinic_id = p_clinic_id AND (p_risk_level IS NULL OR prs.risk_level = p_risk_level)
  ORDER BY prs.score DESC LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
