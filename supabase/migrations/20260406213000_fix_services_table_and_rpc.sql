-- SQL Migration: Sincronización de tablas y RPC para servicios
-- Fecha: 2026-04-06

-- 1. Asegurar tabla clinic_services
CREATE TABLE IF NOT EXISTS public.clinic_services (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id uuid REFERENCES public.clinic_settings(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  duration integer NOT NULL,
  price numeric NOT NULL,
  upselling_enabled boolean DEFAULT false,
  upselling_days_after integer DEFAULT 0,
  upselling_message text,
  created_at timestamptz DEFAULT now()
);

-- 2. Asegurar RLS en clinic_services
ALTER TABLE public.clinic_services ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view services of their clinic" ON public.clinic_services;
DROP POLICY IF EXISTS "Users can insert services for their clinic" ON public.clinic_services;
DROP POLICY IF EXISTS "Users can update services of their clinic" ON public.clinic_services;
DROP POLICY IF EXISTS "Users can delete services of their clinic" ON public.clinic_services;

CREATE POLICY "Users can view services of their clinic" ON public.clinic_services FOR SELECT USING (clinic_id IN (SELECT clinic_id FROM public.user_profiles WHERE id = auth.uid()));
CREATE POLICY "Users can insert services for their clinic" ON public.clinic_services FOR INSERT WITH CHECK (clinic_id IN (SELECT clinic_id FROM public.user_profiles WHERE id = auth.uid()));
CREATE POLICY "Users can update services of their clinic" ON public.clinic_services FOR UPDATE USING (clinic_id IN (SELECT clinic_id FROM public.user_profiles WHERE id = auth.uid()));
CREATE POLICY "Users can delete services of their clinic" ON public.clinic_services FOR DELETE USING (clinic_id IN (SELECT clinic_id FROM public.user_profiles WHERE id = auth.uid()));

-- 3. Actualizar RPC Secure Fetch
CREATE OR REPLACE FUNCTION public.get_clinic_services_secure(p_clinic_id uuid)
RETURNS TABLE (
    id uuid,
    name text,
    duration integer,
    price numeric,
    upselling_enabled boolean,
    upselling_days_after integer,
    upselling_message text
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY
    SELECT 
        s.id, s.name, s.duration, s.price, 
        s.upselling_enabled, s.upselling_days_after, s.upselling_message
    FROM public.clinic_services s
    WHERE s.clinic_id = p_clinic_id;
END;
$$;

-- 4. Arreglar relación de profesionales asignados
ALTER TABLE IF EXISTS public.service_professionals 
DROP CONSTRAINT IF EXISTS service_professionals_service_id_fkey,
ADD CONSTRAINT service_professionals_service_id_fkey 
    FOREIGN KEY (service_id) 
    REFERENCES public.clinic_services(id) 
    ON DELETE CASCADE;
