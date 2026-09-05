-- Formulario de alta de clínica (cuestionario de onboarding reutilizable, /alta-clinica)
-- Captura pública sin login vía RPC; solo platform admins pueden leer las respuestas.

CREATE TABLE IF NOT EXISTS public.clinic_onboarding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  clinic_name text,
  contact_name text,
  contact_email text,
  contact_phone text,
  country text,
  city text,
  submission jsonb NOT NULL,
  source text NOT NULL DEFAULT 'alta-clinica',
  status text NOT NULL DEFAULT 'received',
  clinic_id uuid REFERENCES public.clinic_settings(id) ON DELETE SET NULL,
  reviewed_by uuid,
  reviewed_at timestamptz
);

ALTER TABLE public.clinic_onboarding ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clinic_onboarding_service_role ON public.clinic_onboarding;
CREATE POLICY clinic_onboarding_service_role ON public.clinic_onboarding
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS clinic_onboarding_created_at_idx ON public.clinic_onboarding (created_at DESC);
CREATE INDEX IF NOT EXISTS clinic_onboarding_status_idx ON public.clinic_onboarding (status);

-- Captura pública: cualquiera puede enviar el formulario, pero solo puede insertar (no leer).
CREATE OR REPLACE FUNCTION public.submit_clinic_onboarding(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'payload inválido';
  END IF;

  INSERT INTO public.clinic_onboarding (
    clinic_name, contact_name, contact_email, contact_phone, country, city, submission, source
  ) VALUES (
    NULLIF(TRIM(p_payload->>'clinic_name'),''),
    NULLIF(TRIM(p_payload->>'contact_name'),''),
    NULLIF(TRIM(LOWER(p_payload->>'contact_email')),''),
    NULLIF(TRIM(p_payload->>'contact_phone'),''),
    NULLIF(TRIM(p_payload->>'country'),''),
    NULLIF(TRIM(p_payload->>'city'),''),
    p_payload,
    COALESCE(NULLIF(TRIM(p_payload->>'source'),''),'alta-clinica')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_clinic_onboarding(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_clinic_onboarding(jsonb) TO anon, authenticated, service_role;

-- Solo platform admins leen las respuestas (para el panel HQ).
CREATE OR REPLACE FUNCTION public.get_clinic_onboarding_submissions()
RETURNS SETOF public.clinic_onboarding
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acceso denegado';
  END IF;
  RETURN QUERY SELECT * FROM public.clinic_onboarding ORDER BY created_at DESC LIMIT 500;
END;
$$;

REVOKE ALL ON FUNCTION public.get_clinic_onboarding_submissions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_clinic_onboarding_submissions() TO authenticated, service_role;
