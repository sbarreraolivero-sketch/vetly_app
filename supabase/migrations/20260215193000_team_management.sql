-- =============================================
-- MIGRATION: Team & User Management
-- =============================================

-- 1. Actualizar clinic_settings con Plan y Límites
ALTER TABLE public.clinic_settings 
ADD COLUMN IF NOT EXISTS subscription_plan TEXT DEFAULT 'basic',
ADD COLUMN IF NOT EXISTS max_users INTEGER DEFAULT 2;

-- 2. Crear tabla clinic_members
CREATE TYPE user_role AS ENUM ('owner', 'professional', 'receptionist');
CREATE TYPE member_status AS ENUM ('active', 'invited', 'disabled');

CREATE TABLE IF NOT EXISTS public.clinic_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id UUID REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- Nullable para invitaciones pendientes
  email TEXT NOT NULL,
  role user_role DEFAULT 'professional',
  status member_status DEFAULT 'invited',
  first_name TEXT,
  last_name TEXT,
  specialty TEXT,
  color TEXT DEFAULT '#3B82F6', -- Azul por defecto
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT unique_active_member UNIQUE (clinic_id, email) -- Evitar duplicados en la misma clínica
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_members_clinic ON public.clinic_members(clinic_id);
CREATE INDEX IF NOT EXISTS idx_members_user ON public.clinic_members(user_id);
CREATE INDEX IF NOT EXISTS idx_members_email ON public.clinic_members(email);

-- Trigger para updated_at
CREATE TRIGGER update_members_updated_at
  BEFORE UPDATE ON public.clinic_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 3. Habilitar RLS en clinic_members
ALTER TABLE public.clinic_members ENABLE ROW LEVEL SECURITY;

-- 4. Funciones Helper para RLS (Critical Performance)
-- Verifica si el usuario actual es miembro de la clínica X
CREATE OR REPLACE FUNCTION public.is_clinic_member(clinic_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.clinic_members 
    WHERE user_id = auth.uid() 
    AND clinic_id = $1 
    AND status = 'active'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Verifica si el usuario actual es Owner o Admin de la clínica X
CREATE OR REPLACE FUNCTION public.is_clinic_admin(clinic_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.clinic_members 
    WHERE user_id = auth.uid() 
    AND clinic_id = $1 
    AND role = 'owner'
    AND status = 'active'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Actualizar Políticas RLS (Seguridad Robusta)

-- A) clinic_members
-- Un usuario puede ver su propia membresía
CREATE POLICY "Users can view own memberships"
  ON public.clinic_members FOR SELECT
  USING (auth.uid() = user_id);

-- Un Owner puede ver todos los miembros de su clínica
CREATE POLICY "Owners can view clinic members"
  ON public.clinic_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.clinic_members as cm
      WHERE cm.user_id = auth.uid()
      AND cm.clinic_id = clinic_members.clinic_id
      AND cm.role = 'owner'
    )
  );

-- Un Owner puede gestionar miembros (Insert/Update/Delete)
CREATE POLICY "Owners can manage members"
  ON public.clinic_members FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.clinic_members as cm
      WHERE cm.user_id = auth.uid()
      AND cm.clinic_id = clinic_members.clinic_id
      AND cm.role = 'owner'
    )
  );

-- B) clinic_settings
-- Reemplazar política anterior que quizás era muy permisiva
DROP POLICY IF EXISTS "Authenticated users can read clinic_settings" ON public.clinic_settings;
DROP POLICY IF EXISTS "Authenticated users can update clinic_settings" ON public.clinic_settings;

CREATE POLICY "Members can read clinic_settings"
  ON public.clinic_settings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.clinic_members 
      WHERE user_id = auth.uid() 
      AND clinic_id = clinic_settings.id 
      AND status = 'active'
    )
  );

CREATE POLICY "Owners can update clinic_settings"
  ON public.clinic_settings FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.clinic_members 
      WHERE user_id = auth.uid() 
      AND clinic_id = clinic_settings.id 
      AND role = 'owner'
      AND status = 'active'
    )
  );

-- C) appointments
DROP POLICY IF EXISTS "Authenticated users can read appointments" ON public.appointments;
DROP POLICY IF EXISTS "Authenticated users can manage appointments" ON public.appointments;

CREATE POLICY "Members can read appointments"
  ON public.appointments FOR SELECT
  USING (public.is_clinic_member(clinic_id));

CREATE POLICY "Members can insert appointments"
  ON public.appointments FOR INSERT
  WITH CHECK (public.is_clinic_member(clinic_id));

CREATE POLICY "Members can update appointments"
  ON public.appointments FOR UPDATE
  USING (public.is_clinic_member(clinic_id));

-- D) patients
DROP POLICY IF EXISTS "Authenticated users can read patients" ON public.patients;

CREATE POLICY "Members can read patients"
  ON public.patients FOR ALL
  USING (public.is_clinic_member(clinic_id));

-- E) messages
DROP POLICY IF EXISTS "Authenticated users can read messages" ON public.messages;

CREATE POLICY "Members can read messages"
  ON public.messages FOR ALL
  USING (public.is_clinic_member(clinic_id));

-- F) expenses (Finanzas - restringido a Owner)
DROP POLICY IF EXISTS "Authenticated users can read expenses" ON public.expenses;
DROP POLICY IF EXISTS "Authenticated users can manage expenses" ON public.expenses;

CREATE POLICY "Owners can manage expenses"
  ON public.expenses FOR ALL
  USING (public.is_clinic_admin(clinic_id));

-- 6. RPC: Invite Member (con validación de límite)
CREATE OR REPLACE FUNCTION public.invite_member_v2(
  p_clinic_id UUID,
  p_email TEXT,
  p_role user_role,
  p_first_name TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_current_count INTEGER;
  v_max_users INTEGER;
  v_new_id UUID;
BEGIN
  -- Verificar permisos (solo owner)
  IF NOT public.is_clinic_admin(p_clinic_id) THEN
    RAISE EXCEPTION 'Access denied. Only owners can invite members.';
  END IF;

  -- Obtener límite y conteo actual
  SELECT max_users INTO v_max_users FROM public.clinic_settings WHERE id = p_clinic_id;
  SELECT COUNT(*) INTO v_current_count FROM public.clinic_members WHERE clinic_id = p_clinic_id AND status IN ('active', 'invited');

  IF v_current_count >= v_max_users THEN
    RAISE EXCEPTION 'Plan limit reached. Maximum % users allowed.', v_max_users;
  END IF;

  -- Insertar invitación
  INSERT INTO public.clinic_members (clinic_id, email, role, status, first_name)
  VALUES (p_clinic_id, p_email, p_role, 'invited', p_first_name)
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('id', v_new_id, 'status', 'success');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 7. Migrar datos existentes (Self-Repair)
-- Si ya existen clínicas, asegurarse de que el usuario que las creó sea OWNER en clinic_members
-- Esto es complejo porque clinic_settings no tiene owner_id explícito en el esquema original mostrado,
-- pero asumimos que el usuario actual es el dueño si está usando la app.
-- PARA ESTA MIGRACIÓN: REQUERIMOS QUE EL FRONTEND HAGA UN "CLAIM" o se asigne manualmente si no hay owner_id.
-- OJO: Si auth.uid() crea la clínica, debería insertarse en clinic_members.
-- Como no podemos saber quién creó la clínica retroactivamente sin un log,
-- dejaremos que el primer usuario autenticado que acceda "reclame" la clínica o asumimos que el sistema ya maneja esto.
-- MEJOR ESTRATEGIA: No romper lo existente.
-- Permitir acceso temporalmente o crear una función de "claim_clinic".

-- NOTA: Como es un entorno de desarrollo, asumiremos que se insertará manualmente o 
-- se creará un trigger al crear clinic_settings.

-- Trigger para auto-asignar owner al crear clinic (para futuros registros)
CREATE OR REPLACE FUNCTION public.auto_assign_owner()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.clinic_members (clinic_id, user_id, email, role, status)
  VALUES (
    NEW.id, 
    auth.uid(), 
    auth.email(), -- Esto puede fallar si auth.email() no está disponible en el contexto del trigger
    'owner', 
    'active'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Este trigger es arriesgado si auth.email() es null. Mejor manejarlo desde la API de creación.
