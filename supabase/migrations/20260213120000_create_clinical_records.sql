-- =============================================
-- TABLA: clinical_records
-- Historial clínico de pacientes
-- =============================================

CREATE TABLE IF NOT EXISTS public.clinical_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES public.patients(id) ON DELETE CASCADE,
  
  -- Detalles del registro
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  treatment_name TEXT NOT NULL, -- Nombre del tratamiento realizado
  
  description TEXT, -- Descripción detallada del procedimiento
  notes TEXT, -- Notas internas o observaciones
  
  -- Archivos adjuntos (fotos antes/después - estructura JSON)
  -- Ejemplo: [{"url": "...", "type": "image/jpeg", "tag": "before"}]
  attachments JSONB DEFAULT '[]'::jsonb,
  
  -- Metadata
  created_by UUID REFERENCES auth.users(id), -- Usuario que creó el registro
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_clinical_records_patient ON public.clinical_records(patient_id);
CREATE INDEX IF NOT EXISTS idx_clinical_records_clinic ON public.clinical_records(clinic_id);
CREATE INDEX IF NOT EXISTS idx_clinical_records_date ON public.clinical_records(date DESC);

-- Trigger para updated_at
CREATE TRIGGER update_clinical_records_updated_at
  BEFORE UPDATE ON public.clinical_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- =============================================
-- RLS POLICIES
-- =============================================

ALTER TABLE public.clinical_records ENABLE ROW LEVEL SECURITY;

-- Service Role (Edge Functions)
CREATE POLICY "Service role full access to clinical_records"
  ON public.clinical_records FOR ALL
  USING (auth.role() = 'service_role');

-- Usuarios Autenticados (Dashboard)
CREATE POLICY "Authenticated users can read clinical_records"
  ON public.clinical_records FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert clinical_records"
  ON public.clinical_records FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update clinical_records"
  ON public.clinical_records FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete clinical_records"
  ON public.clinical_records FOR DELETE
  USING (auth.role() = 'authenticated');
