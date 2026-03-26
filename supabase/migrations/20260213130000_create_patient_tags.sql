-- =============================================
-- TABLA: tags
-- Etiquetas para segmentación de pacientes (ej: VIP, Piel Sensible)
-- =============================================

CREATE TABLE IF NOT EXISTS public.tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#E5E7EB', -- Hex color
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Evitar duplicados de nombre en la misma clínica
  UNIQUE(clinic_id, name)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_tags_clinic ON public.tags(clinic_id);

-- RLS para tags
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can select tags"
  ON public.tags FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert tags"
  ON public.tags FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update tags"
  ON public.tags FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete tags"
  ON public.tags FOR DELETE
  USING (auth.role() = 'authenticated');

-- =============================================
-- TABLA: patient_tags
-- Relación muchos a muchos entre pacientes y etiquetas
-- =============================================

CREATE TABLE IF NOT EXISTS public.patient_tags (
  patient_id UUID REFERENCES public.patients(id) ON DELETE CASCADE,
  tag_id UUID REFERENCES public.tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  PRIMARY KEY (patient_id, tag_id)
);

-- RLS para patient_tags
ALTER TABLE public.patient_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can select patient_tags"
  ON public.patient_tags FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert patient_tags"
  ON public.patient_tags FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete patient_tags"
  ON public.patient_tags FOR DELETE
  USING (auth.role() = 'authenticated');
