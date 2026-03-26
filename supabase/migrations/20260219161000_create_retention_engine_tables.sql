-- =============================================================
-- MIGRATION: Revenue Retention Engine™ — Core Tables
-- =============================================================

-- 1. Service Return Windows (ERW)
CREATE TABLE IF NOT EXISTS public.service_return_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  service_name TEXT NOT NULL,
  return_window_days INTEGER NOT NULL DEFAULT 30,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(clinic_id, service_name)
);
CREATE INDEX IF NOT EXISTS idx_srw_clinic ON public.service_return_windows(clinic_id);

-- 2. Patient Retention Scores
CREATE TABLE IF NOT EXISTS public.patient_retention_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  score INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  risk_level TEXT NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high')),
  days_since_last_visit INTEGER DEFAULT 0,
  expected_return_days INTEGER DEFAULT 30,
  delay_days INTEGER DEFAULT 0,
  avg_ticket NUMERIC(12,2) DEFAULT 0,
  total_visits INTEGER DEFAULT 0,
  cancellation_count INTEGER DEFAULT 0,
  no_show_count INTEGER DEFAULT 0,
  is_vip BOOLEAN DEFAULT false,
  frequency_irregular BOOLEAN DEFAULT false,
  high_ticket BOOLEAN DEFAULT false,
  last_service TEXT,
  last_visit_date DATE,
  assigned_professional TEXT,
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  previous_risk_level TEXT,
  UNIQUE(clinic_id, patient_id)
);
CREATE INDEX IF NOT EXISTS idx_prs_clinic ON public.patient_retention_scores(clinic_id);
CREATE INDEX IF NOT EXISTS idx_prs_risk ON public.patient_retention_scores(risk_level);
CREATE INDEX IF NOT EXISTS idx_prs_score ON public.patient_retention_scores(score DESC);

-- 3. Retention Protocols
CREATE TABLE IF NOT EXISTS public.retention_protocols (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  risk_level_trigger TEXT NOT NULL CHECK (risk_level_trigger IN ('medium', 'high')),
  actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  execution_mode TEXT NOT NULL DEFAULT 'supervised'
    CHECK (execution_mode IN ('supervised', 'autonomous')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rp_clinic ON public.retention_protocols(clinic_id);

-- 4. AI Action Log
CREATE TABLE IF NOT EXISTS public.ai_action_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES public.patients(id) ON DELETE SET NULL,
  protocol_id UUID REFERENCES public.retention_protocols(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  action_details JSONB DEFAULT '{}'::jsonb,
  trigger_score INTEGER,
  trigger_risk_level TEXT,
  execution_mode TEXT CHECK (execution_mode IN ('supervised', 'autonomous')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'executed', 'reverted', 'rejected', 'failed')),
  result TEXT,
  result_revenue NUMERIC(12,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  executed_at TIMESTAMPTZ,
  reverted_at TIMESTAMPTZ,
  approved_by UUID REFERENCES auth.users(id),
  reverted_by UUID REFERENCES auth.users(id)
);
CREATE INDEX IF NOT EXISTS idx_aal_clinic ON public.ai_action_log(clinic_id);
CREATE INDEX IF NOT EXISTS idx_aal_patient ON public.ai_action_log(patient_id);
CREATE INDEX IF NOT EXISTS idx_aal_status ON public.ai_action_log(status);
CREATE INDEX IF NOT EXISTS idx_aal_created ON public.ai_action_log(created_at DESC);

-- 5. Retention Score History
CREATE TABLE IF NOT EXISTS public.retention_score_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  risk_level TEXT NOT NULL,
  computed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rsh_patient ON public.retention_score_history(patient_id, computed_at DESC);

-- RLS
ALTER TABLE public.service_return_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_retention_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retention_protocols ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_action_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retention_score_history ENABLE ROW LEVEL SECURITY;

-- Service role policies
CREATE POLICY "Service role full access to service_return_windows"
  ON public.service_return_windows FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access to patient_retention_scores"
  ON public.patient_retention_scores FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access to retention_protocols"
  ON public.retention_protocols FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access to ai_action_log"
  ON public.ai_action_log FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access to retention_score_history"
  ON public.retention_score_history FOR ALL USING (auth.role() = 'service_role');

-- Authenticated user policies (clinic membership)
CREATE POLICY "Clinic members can read service_return_windows"
  ON public.service_return_windows FOR SELECT
  USING (clinic_id IN (SELECT clinic_id FROM public.clinic_members WHERE user_id = auth.uid() AND status = 'active'));

CREATE POLICY "Clinic members can manage service_return_windows"
  ON public.service_return_windows FOR ALL
  USING (clinic_id IN (SELECT clinic_id FROM public.clinic_members WHERE user_id = auth.uid() AND status = 'active' AND role IN ('owner', 'admin')));

CREATE POLICY "Clinic members can read retention_scores"
  ON public.patient_retention_scores FOR SELECT
  USING (clinic_id IN (SELECT clinic_id FROM public.clinic_members WHERE user_id = auth.uid() AND status = 'active'));

CREATE POLICY "Clinic members can read retention_protocols"
  ON public.retention_protocols FOR SELECT
  USING (clinic_id IN (SELECT clinic_id FROM public.clinic_members WHERE user_id = auth.uid() AND status = 'active'));

CREATE POLICY "Clinic members can manage retention_protocols"
  ON public.retention_protocols FOR ALL
  USING (clinic_id IN (SELECT clinic_id FROM public.clinic_members WHERE user_id = auth.uid() AND status = 'active' AND role IN ('owner', 'admin')));

CREATE POLICY "Clinic members can read ai_action_log"
  ON public.ai_action_log FOR SELECT
  USING (clinic_id IN (SELECT clinic_id FROM public.clinic_members WHERE user_id = auth.uid() AND status = 'active'));

CREATE POLICY "Clinic members can update ai_action_log"
  ON public.ai_action_log FOR UPDATE
  USING (clinic_id IN (SELECT clinic_id FROM public.clinic_members WHERE user_id = auth.uid() AND status = 'active' AND role IN ('owner', 'admin')));

CREATE POLICY "Clinic members can read retention_score_history"
  ON public.retention_score_history FOR SELECT
  USING (clinic_id IN (SELECT clinic_id FROM public.clinic_members WHERE user_id = auth.uid() AND status = 'active'));

-- Triggers
CREATE TRIGGER update_service_return_windows_updated_at
  BEFORE UPDATE ON public.service_return_windows
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_retention_protocols_updated_at
  BEFORE UPDATE ON public.retention_protocols
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Initialize defaults RPC
CREATE OR REPLACE FUNCTION public.initialize_default_return_windows(p_clinic_id UUID)
RETURNS void AS $$
DECLARE
  v_service JSONB;
  v_service_name TEXT;
  v_default_days INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.clinic_members
    WHERE user_id = auth.uid() AND clinic_id = p_clinic_id AND status = 'active' AND role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'Access denied.';
  END IF;

  FOR v_service IN
    SELECT jsonb_array_elements(services) FROM public.clinic_settings WHERE id = p_clinic_id
  LOOP
    v_service_name := v_service->>'name';
    v_default_days := CASE
      WHEN LOWER(v_service_name) LIKE '%botox%' THEN 120
      WHEN LOWER(v_service_name) LIKE '%hialur%' THEN 180
      WHEN LOWER(v_service_name) LIKE '%limpieza%' THEN 30
      WHEN LOWER(v_service_name) LIKE '%dermapen%' THEN 30
      WHEN LOWER(v_service_name) LIKE '%peeling%' THEN 21
      WHEN LOWER(v_service_name) LIKE '%laser%' THEN 30
      WHEN LOWER(v_service_name) LIKE '%depila%' THEN 30
      WHEN LOWER(v_service_name) LIKE '%masaje%' THEN 14
      WHEN LOWER(v_service_name) LIKE '%facial%' THEN 30
      WHEN LOWER(v_service_name) LIKE '%corpo%' THEN 14
      WHEN LOWER(v_service_name) LIKE '%ortodoncia%' THEN 30
      WHEN LOWER(v_service_name) LIKE '%control%' THEN 30
      WHEN LOWER(v_service_name) LIKE '%consulta%' THEN 180
      ELSE 30
    END;

    INSERT INTO public.service_return_windows (clinic_id, service_name, return_window_days)
    VALUES (p_clinic_id, v_service_name, v_default_days)
    ON CONFLICT (clinic_id, service_name) DO NOTHING;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
