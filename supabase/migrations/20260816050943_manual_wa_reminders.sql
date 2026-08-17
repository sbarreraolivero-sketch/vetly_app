-- ============================================================================
-- Recordatorios manuales por wa.me
-- ============================================================================
-- Un cliente Core nuevo no puede usar recordatorios automáticos el día 1:
-- requieren conectar WhatsApp por Embedded Signup de Meta y esperar aprobación
-- de plantillas (a Vetly le tomó ~48 h y borrar una WABA conectar Linares).
-- El envío manual por link wa.me funciona sin nada de eso, no cuesta nada y
-- deja registro — que es lo que después alimenta el aviso de upgrade.
-- ============================================================================

-- Plantilla del recordatorio manual. NO es una plantilla de Meta: es texto libre
-- que se pre-rellena en el chat, así que no necesita aprobación ni tener
-- WhatsApp conectado. Por eso usa placeholders con nombre y no {{1}}..{{5}}.
ALTER TABLE public.reminder_settings
    ADD COLUMN IF NOT EXISTS manual_wa_template TEXT
    DEFAULT 'Hola {tutor}! Te recordamos la cita de {paciente} para {servicio} el {fecha} a las {hora}. Cualquier cosa nos escribes por aqui. {clinica}';

COMMENT ON COLUMN public.reminder_settings.manual_wa_template IS
    'Texto libre del recordatorio manual (wa.me). Placeholders: {tutor} {paciente} {servicio} {fecha} {hora} {clinica}.';

-- `reminder_logs` solo tenía policy de SELECT (el cron escribe con service_role,
-- que salta RLS). El envío manual se registra desde el navegador con la sesión
-- del usuario, así que necesita INSERT acotado a su propia clínica.
DROP POLICY IF EXISTS reminder_logs_insert_members ON public.reminder_logs;
CREATE POLICY reminder_logs_insert_members ON public.reminder_logs
    FOR INSERT TO authenticated
    WITH CHECK (public.is_clinic_member(clinic_id));

-- Índice parcial para el contador mensual de envíos manuales.
CREATE INDEX IF NOT EXISTS idx_reminder_logs_manual_wa
    ON public.reminder_logs (clinic_id, created_at)
    WHERE type = 'manual_wa';
