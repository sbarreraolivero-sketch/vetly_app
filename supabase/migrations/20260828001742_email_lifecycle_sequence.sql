-- ════════════════════════════════════════════════════════════════════════════
-- SECUENCIA DE CORREOS DE ONBOARDING/RETENCIÓN — plan Core
-- ════════════════════════════════════════════════════════════════════════════
--
-- Motor de correos por comportamiento (no por día fijo): cada clínica recibe
-- solo los correos que le aplican según lo que hizo o no hizo en el sistema.
-- Ver supabase/functions/cron-lifecycle-emails/index.ts para la lógica.

-- ── Token de baja, no adivinable ──────────────────────────────────────────
-- Mismo mecanismo ya usado para tutors.portal_token (sesión 74 corrigió
-- exactamente esta clase de vulnerabilidad — nunca usar el UUID de la fila
-- como identificador público). Reutiliza generate_portal_token(), que ya
-- produce 22 caracteres base64url via extensions.gen_random_bytes(16).
ALTER TABLE public.clinic_settings
    ADD COLUMN IF NOT EXISTS lifecycle_email_token TEXT UNIQUE,
    ADD COLUMN IF NOT EXISTS lifecycle_emails_opt_out BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.clinic_settings.lifecycle_email_token IS
    'Token no adivinable para el link de baja de la secuencia de correos de onboarding. Nunca usar el id de la clínica para esto.';
COMMENT ON COLUMN public.clinic_settings.lifecycle_emails_opt_out IS
    'true = la clínica se dio de baja de la secuencia de correos de onboarding/retención. No afecta correos operativos (recibos, avisos de pago).';

CREATE OR REPLACE FUNCTION public.set_lifecycle_email_token()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.lifecycle_email_token IS NULL THEN
        NEW.lifecycle_email_token := public.generate_portal_token();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER FUNCTION public.set_lifecycle_email_token() SET search_path = public, extensions;

DROP TRIGGER IF EXISTS trigger_set_lifecycle_email_token ON public.clinic_settings;
CREATE TRIGGER trigger_set_lifecycle_email_token
    BEFORE INSERT ON public.clinic_settings
    FOR EACH ROW EXECUTE FUNCTION public.set_lifecycle_email_token();

-- Backfill de las clínicas ya existentes.
UPDATE public.clinic_settings
SET lifecycle_email_token = public.generate_portal_token()
WHERE lifecycle_email_token IS NULL;

-- ── Log de envíos — fuente de idempotencia ────────────────────────────────
-- UNIQUE(clinic_id, email_key) es el mecanismo de "enviar como máximo una
-- vez" para cada paso de la secuencia — sin esto haría falta un lock aparte.
CREATE TABLE IF NOT EXISTS public.email_sequence_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
    email_key TEXT NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resend_id TEXT,
    UNIQUE (clinic_id, email_key)
);

CREATE INDEX IF NOT EXISTS idx_email_sequence_log_clinic ON public.email_sequence_log (clinic_id);

COMMENT ON TABLE public.email_sequence_log IS
    'Registro de qué correo de la secuencia de onboarding se mandó a qué clínica. email_key identifica el paso (welcome, day1_get_started, etc). Solo service_role la toca.';

ALTER TABLE public.email_sequence_log ENABLE ROW LEVEL SECURITY;

-- Solo service_role (edge functions) lee/escribe — mismo patrón que debug_logs
-- (policy acotada por rol de Postgres, no por claim de auth.role()). Sin
-- policies para authenticated/anon: ninguna pantalla del dashboard necesita
-- leer esto hoy.
DROP POLICY IF EXISTS "service_role_all_email_sequence_log" ON public.email_sequence_log;
CREATE POLICY "service_role_all_email_sequence_log" ON public.email_sequence_log
    FOR ALL TO service_role USING (true) WITH CHECK (true);
