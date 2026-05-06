-- =============================================
-- FULL MIGRATION: satisfaction_surveys
-- Crea la tabla si no existe + agrega columnas para
-- button-reply tracking (phone_number, feedback_context)
-- Ejecutar en: Supabase SQL Editor (proyecto ehmncwawzdciajvuallg)
-- =============================================

-- 1. Crear tabla base si no existe
CREATE TABLE IF NOT EXISTS public.satisfaction_surveys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES public.appointments(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES public.patients(id) ON DELETE SET NULL,

  -- Estado de la encuesta
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'responded', 'failed')),

  -- Resultados
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  feedback TEXT,

  -- Columnas para tracking de respuestas via botón
  phone_number TEXT,
  feedback_context TEXT,

  -- Metadata de mensajería
  whatsapp_message_id TEXT,

  -- Timestamps
  sent_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Agregar columnas si la tabla ya existía sin ellas
ALTER TABLE public.satisfaction_surveys
  ADD COLUMN IF NOT EXISTS phone_number TEXT,
  ADD COLUMN IF NOT EXISTS feedback_context TEXT;

-- 3. Índices
CREATE INDEX IF NOT EXISTS idx_surveys_appointment ON public.satisfaction_surveys(appointment_id);
CREATE INDEX IF NOT EXISTS idx_surveys_patient     ON public.satisfaction_surveys(patient_id);
CREATE INDEX IF NOT EXISTS idx_surveys_clinic      ON public.satisfaction_surveys(clinic_id);
CREATE INDEX IF NOT EXISTS idx_surveys_phone       ON public.satisfaction_surveys(phone_number);

-- 4. Trigger para updated_at (solo si no existe)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'update_satisfaction_surveys_updated_at'
  ) THEN
    CREATE TRIGGER update_satisfaction_surveys_updated_at
      BEFORE UPDATE ON public.satisfaction_surveys
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;
END;
$$;

-- 5. RLS
ALTER TABLE public.satisfaction_surveys ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'satisfaction_surveys'
    AND policyname = 'Service role full access to surveys'
  ) THEN
    CREATE POLICY "Service role full access to surveys"
      ON public.satisfaction_surveys FOR ALL
      USING (auth.role() = 'service_role');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'satisfaction_surveys'
    AND policyname = 'Authenticated users can read surveys'
  ) THEN
    CREATE POLICY "Authenticated users can read surveys"
      ON public.satisfaction_surveys FOR SELECT
      USING (auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'satisfaction_surveys'
    AND policyname = 'Authenticated users can insert surveys'
  ) THEN
    CREATE POLICY "Authenticated users can insert surveys"
      ON public.satisfaction_surveys FOR INSERT
      WITH CHECK (auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'satisfaction_surveys'
    AND policyname = 'Authenticated users can update surveys'
  ) THEN
    CREATE POLICY "Authenticated users can update surveys"
      ON public.satisfaction_surveys FOR UPDATE
      USING (auth.role() = 'authenticated');
  END IF;
END;
$$;
