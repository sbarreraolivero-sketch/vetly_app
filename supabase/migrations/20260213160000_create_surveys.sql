
-- =============================================
-- TABLA: satisfaction_surveys
-- Encuestas de satisfacción post-cita (NPS)
-- =============================================

CREATE TABLE IF NOT EXISTS public.satisfaction_surveys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES public.appointments(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES public.patients(id) ON DELETE CASCADE,
  
  -- Estado de la encuesta
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'responded', 'failed')),
  
  -- Resultados
  rating INTEGER CHECK (rating >= 1 AND rating <= 5), -- 1 a 5 estrellas
  feedback TEXT, -- Comentarios opcionales
  
  -- Metadata de mensajería
  whatsapp_message_id TEXT, -- ID del mensaje enviado
  
  -- Timestamps
  sent_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_surveys_appointment ON public.satisfaction_surveys(appointment_id);
CREATE INDEX IF NOT EXISTS idx_surveys_patient ON public.satisfaction_surveys(patient_id);
CREATE INDEX IF NOT EXISTS idx_surveys_clinic ON public.satisfaction_surveys(clinic_id);

-- Trigger para updated_at
CREATE TRIGGER update_satisfaction_surveys_updated_at
  BEFORE UPDATE ON public.satisfaction_surveys
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- =============================================
-- RLS POLICIES
-- =============================================

ALTER TABLE public.satisfaction_surveys ENABLE ROW LEVEL SECURITY;

-- Service Role (Edge Functions)
CREATE POLICY "Service role full access to surveys"
  ON public.satisfaction_surveys FOR ALL
  USING (auth.role() = 'service_role');

-- Usuarios Autenticados (Dashboard)
CREATE POLICY "Authenticated users can read surveys"
  ON public.satisfaction_surveys FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert surveys"
  ON public.satisfaction_surveys FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update surveys"
  ON public.satisfaction_surveys FOR UPDATE
  USING (auth.role() = 'authenticated');
