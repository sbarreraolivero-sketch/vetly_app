-- =============================================
-- CITENLY AI - ESQUEMA DE BASE DE DATOS
-- Supabase PostgreSQL Schema
-- =============================================

-- Habilitar extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- TABLA: clinic_settings
-- Configuración de la clínica
-- =============================================
CREATE TABLE IF NOT EXISTS public.clinic_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_name TEXT NOT NULL,
  
  -- Servicios disponibles (array de objetos JSON)
  -- Ejemplo: [{"id": "uuid", "name": "Limpieza Facial", "duration": 60, "price": 800}]
  services JSONB NOT NULL DEFAULT '[]'::jsonb,
  
  -- Horarios de trabajo (objeto JSON con días de la semana)
  -- Ejemplo: {"monday": {"open": "09:00", "close": "18:00"}, "sunday": null}
  working_hours JSONB NOT NULL DEFAULT '{
    "monday": {"open": "09:00", "close": "18:00"},
    "tuesday": {"open": "09:00", "close": "18:00"},
    "wednesday": {"open": "09:00", "close": "18:00"},
    "thursday": {"open": "09:00", "close": "18:00"},
    "friday": {"open": "09:00", "close": "18:00"},
    "saturday": {"open": "09:00", "close": "14:00"},
    "sunday": null
  }'::jsonb,
  
  -- Zona horaria
  timezone TEXT NOT NULL DEFAULT 'America/Mexico_City',
  
  -- API Keys (encriptadas en producción)
  ycloud_api_key TEXT,
  ycloud_phone_number TEXT, -- Número de WhatsApp Business
  openai_api_key TEXT,
  openai_model TEXT DEFAULT 'gpt-4o-mini',
  
  -- Configuración del asistente IA
  ai_personality TEXT DEFAULT 'Eres un asistente amable y profesional para una clínica estética. Responde de manera cordial, breve y clara. Nunca inventes horarios o servicios que no existan.',
  ai_welcome_message TEXT DEFAULT '¡Hola! 👋 Bienvenid@ a nuestra clínica. Soy tu asistente virtual y estoy aquí para ayudarte a agendar citas o resolver tus dudas. ¿En qué puedo ayudarte?',
  ai_auto_respond BOOLEAN DEFAULT true,
  
  -- Configuración de recordatorios
  reminders_enabled BOOLEAN DEFAULT true,
  reminders_time TIME DEFAULT '08:00:00',
  reminders_hours_before INTEGER DEFAULT 24,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- TABLA: appointments
-- Citas de los pacientes
-- =============================================
CREATE TABLE IF NOT EXISTS public.appointments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  
  -- Información del paciente
  patient_name TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  
  -- Detalles de la cita
  service TEXT,
  service_id UUID, -- Referencia al servicio en clinic_settings.services
  appointment_date TIMESTAMPTZ NOT NULL,
  duration INTEGER DEFAULT 60, -- Duración en minutos
  
  -- Estado de la cita
  status TEXT NOT NULL DEFAULT 'pending' 
    CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed', 'no_show')),
  
  -- Notas adicionales
  notes TEXT,
  
  -- Seguimiento de recordatorios
  reminder_sent BOOLEAN DEFAULT false,
  reminder_sent_at TIMESTAMPTZ,
  confirmation_received BOOLEAN DEFAULT false,
  confirmation_response TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para búsquedas frecuentes
CREATE INDEX IF NOT EXISTS idx_appointments_phone ON public.appointments(phone_number);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON public.appointments(appointment_date);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON public.appointments(status);
CREATE INDEX IF NOT EXISTS idx_appointments_clinic ON public.appointments(clinic_id);

-- =============================================
-- TABLA: messages
-- Historial de mensajes de WhatsApp
-- =============================================
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  
  -- Información del mensaje
  phone_number TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  content TEXT NOT NULL,
  message_type TEXT DEFAULT 'text', -- text, image, audio, etc.
  
  -- Metadata de YCloud
  ycloud_message_id TEXT,
  ycloud_status TEXT, -- sent, delivered, read, failed
  
  -- Metadata de IA
  ai_generated BOOLEAN DEFAULT false,
  ai_function_called TEXT, -- Nombre de la función llamada (check_availability, create_appointment)
  ai_function_result JSONB, -- Resultado de la función
  
  -- Timestamp
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_messages_phone ON public.messages(phone_number);
CREATE INDEX IF NOT EXISTS idx_messages_created ON public.messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_clinic ON public.messages(clinic_id);

-- =============================================
-- TABLA: patients (opcional, para historial)
-- =============================================
CREATE TABLE IF NOT EXISTS public.patients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  
  phone_number TEXT NOT NULL UNIQUE,
  name TEXT,
  email TEXT,
  notes TEXT,
  
  -- Estadísticas
  total_appointments INTEGER DEFAULT 0,
  last_appointment_at TIMESTAMPTZ,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patients_phone ON public.patients(phone_number);

-- =============================================
-- FUNCIONES Y TRIGGERS
-- =============================================

-- Función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers para updated_at
CREATE TRIGGER update_clinic_settings_updated_at
  BEFORE UPDATE ON public.clinic_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_appointments_updated_at
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_patients_updated_at
  BEFORE UPDATE ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- =============================================
-- FUNCIÓN: check_availability
-- Verifica disponibilidad para una fecha/hora
-- =============================================
CREATE OR REPLACE FUNCTION public.check_availability(
  p_clinic_id UUID,
  p_date DATE,
  p_time TIME,
  p_duration INTEGER DEFAULT 60
)
RETURNS BOOLEAN AS $$
DECLARE
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_conflict_count INTEGER;
  v_working_hours JSONB;
  v_day_of_week TEXT;
  v_day_hours JSONB;
  v_open_time TIME;
  v_close_time TIME;
BEGIN
  -- Construir timestamp de inicio y fin
  v_start := (p_date || ' ' || p_time)::TIMESTAMPTZ;
  v_end := v_start + (p_duration || ' minutes')::INTERVAL;
  
  -- Obtener horarios de trabajo
  SELECT working_hours INTO v_working_hours
  FROM public.clinic_settings
  WHERE id = p_clinic_id;
  
  -- Obtener día de la semana
  v_day_of_week := LOWER(TO_CHAR(p_date, 'day'));
  v_day_of_week := TRIM(v_day_of_week);
  
  -- Mapear a inglés si es necesario
  v_day_of_week := CASE v_day_of_week
    WHEN 'lunes' THEN 'monday'
    WHEN 'martes' THEN 'tuesday'
    WHEN 'miércoles' THEN 'wednesday'
    WHEN 'jueves' THEN 'thursday'
    WHEN 'viernes' THEN 'friday'
    WHEN 'sábado' THEN 'saturday'
    WHEN 'domingo' THEN 'sunday'
    ELSE v_day_of_week
  END;
  
  -- Verificar si el día está abierto
  v_day_hours := v_working_hours->v_day_of_week;
  IF v_day_hours IS NULL OR v_day_hours = 'null'::jsonb THEN
    RETURN FALSE; -- Cerrado ese día
  END IF;
  
  -- Verificar horario
  v_open_time := (v_day_hours->>'open')::TIME;
  v_close_time := (v_day_hours->>'close')::TIME;
  
  IF p_time < v_open_time OR (p_time + (p_duration || ' minutes')::INTERVAL)::TIME > v_close_time THEN
    RETURN FALSE; -- Fuera de horario
  END IF;
  
  -- Verificar colisiones con otras citas
  SELECT COUNT(*) INTO v_conflict_count
  FROM public.appointments
  WHERE clinic_id = p_clinic_id
    AND status NOT IN ('cancelled', 'no_show')
    AND (
      (appointment_date, appointment_date + (duration || ' minutes')::INTERVAL)
      OVERLAPS
      (v_start, v_end)
    );
  
  RETURN v_conflict_count = 0;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- FUNCIÓN: get_available_slots
-- Obtiene slots disponibles para un día
-- =============================================
CREATE OR REPLACE FUNCTION public.get_available_slots(
  p_clinic_id UUID,
  p_date DATE,
  p_duration INTEGER DEFAULT 60
)
RETURNS TABLE(slot_time TIME, is_available BOOLEAN) AS $$
DECLARE
  v_working_hours JSONB;
  v_day_of_week TEXT;
  v_day_hours JSONB;
  v_open_time TIME;
  v_close_time TIME;
  v_current_time TIME;
BEGIN
  -- Obtener horarios de trabajo
  SELECT working_hours INTO v_working_hours
  FROM public.clinic_settings
  WHERE id = p_clinic_id;
  
  -- Obtener día de la semana
  v_day_of_week := LOWER(TO_CHAR(p_date, 'day'));
  v_day_of_week := TRIM(v_day_of_week);
  
  -- Mapear a inglés
  v_day_of_week := CASE v_day_of_week
    WHEN 'monday' THEN 'monday'
    WHEN 'tuesday' THEN 'tuesday'
    WHEN 'wednesday' THEN 'wednesday'
    WHEN 'thursday' THEN 'thursday'
    WHEN 'friday' THEN 'friday'
    WHEN 'saturday' THEN 'saturday'
    WHEN 'sunday' THEN 'sunday'
    ELSE v_day_of_week
  END;
  
  v_day_hours := v_working_hours->v_day_of_week;
  
  IF v_day_hours IS NULL OR v_day_hours = 'null'::jsonb THEN
    RETURN; -- Cerrado
  END IF;
  
  v_open_time := (v_day_hours->>'open')::TIME;
  v_close_time := (v_day_hours->>'close')::TIME;
  v_current_time := v_open_time;
  
  -- Generar slots cada 30 minutos
  WHILE v_current_time + (p_duration || ' minutes')::INTERVAL <= v_close_time LOOP
    slot_time := v_current_time;
    is_available := public.check_availability(p_clinic_id, p_date, v_current_time, p_duration);
    RETURN NEXT;
    v_current_time := v_current_time + '30 minutes'::INTERVAL;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================

-- Habilitar RLS
ALTER TABLE public.clinic_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;

-- Políticas para service role (Edge Functions)
CREATE POLICY "Service role full access to clinic_settings"
  ON public.clinic_settings FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access to appointments"
  ON public.appointments FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access to messages"
  ON public.messages FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access to patients"
  ON public.patients FOR ALL
  USING (auth.role() = 'service_role');

-- Políticas para usuarios autenticados (Dashboard)
CREATE POLICY "Authenticated users can read clinic_settings"
  ON public.clinic_settings FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update clinic_settings"
  ON public.clinic_settings FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can read appointments"
  ON public.appointments FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage appointments"
  ON public.appointments FOR ALL
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can read messages"
  ON public.messages FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can read patients"
  ON public.patients FOR SELECT
  USING (auth.role() = 'authenticated');

-- =============================================
-- DATOS DE EJEMPLO (SEED)
-- =============================================
INSERT INTO public.clinic_settings (
  clinic_name,
  services,
  working_hours,
  timezone,
  ai_personality,
  ai_welcome_message
) VALUES (
  'Clínica Estética Demo',
  '[
    {"id": "svc-1", "name": "Limpieza Facial Profunda", "duration": 60, "price": 800},
    {"id": "svc-2", "name": "Botox - Por Zona", "duration": 30, "price": 3500},
    {"id": "svc-3", "name": "Ácido Hialurónico", "duration": 45, "price": 5000},
    {"id": "svc-4", "name": "Dermapen", "duration": 60, "price": 2500},
    {"id": "svc-5", "name": "Peeling Químico", "duration": 45, "price": 1500}
  ]'::jsonb,
  '{
    "monday": {"open": "09:00", "close": "18:00"},
    "tuesday": {"open": "09:00", "close": "18:00"},
    "wednesday": {"open": "09:00", "close": "18:00"},
    "thursday": {"open": "09:00", "close": "18:00"},
    "friday": {"open": "09:00", "close": "18:00"},
    "saturday": {"open": "09:00", "close": "14:00"},
    "sunday": null
  }'::jsonb,
  'America/Mexico_City',
  'Eres un asistente amable y profesional para una clínica estética. Responde de manera cordial, breve y clara. Nunca inventes horarios o servicios que no existan. Usa emojis con moderación para dar calidez a las respuestas.',
  '¡Hola! 👋 Bienvenid@ a nuestra clínica. Soy tu asistente virtual y estoy aquí para ayudarte a agendar citas o resolver tus dudas. ¿En qué puedo ayudarte?'
) ON CONFLICT DO NOTHING;
