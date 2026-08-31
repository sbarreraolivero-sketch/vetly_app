-- ════════════════════════════════════════════════════════════════════════════
-- HQ "Clínicas" — actividad en vivo + tracking de apertura de correos
-- ════════════════════════════════════════════════════════════════════════════

-- Tracking de eventos de Resend (delivered/opened) sobre los correos de la
-- secuencia de onboarding. `opened_at` es lo que pidió el usuario ("correos
-- abiertos") — hasta ahora `email_sequence_log` solo sabía "enviado".
ALTER TABLE public.email_sequence_log
    ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS open_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.email_sequence_log.opened_at IS
    'Timestamp del primer evento email.opened de Resend para este envío. NULL = no abierto (o Resend aún no lo reportó).';
COMMENT ON COLUMN public.email_sequence_log.open_count IS
    'Cuántas veces Resend reportó apertura (un mismo correo puede abrirse más de una vez).';

-- ── RPC: actividad en vivo por clínica, para el HQ ─────────────────────────
-- Un solo round-trip agrega señales de uso real (pacientes, canal de
-- WhatsApp conectado, reservas online, ingresos) + progreso de la secuencia
-- de onboarding, en vez de que el cliente haga N×5 queries por clínica.
CREATE OR REPLACE FUNCTION public.get_hq_clinic_activity()
RETURNS TABLE (
    clinic_id UUID,
    patients_count BIGINT,
    has_whatsapp BOOLEAN,
    has_booking_page BOOLEAN,
    incomes_count BIGINT,
    incomes_total NUMERIC,
    appointments_count BIGINT,
    emails_sent_count BIGINT,
    emails_opened_count BIGINT,
    last_email_key TEXT,
    last_email_sent_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
    IF COALESCE(auth.role(), 'service_role') <> 'service_role'
       AND NOT public.is_platform_admin() THEN
        RAISE EXCEPTION 'Unauthorized: platform admin access required';
    END IF;

    RETURN QUERY
    SELECT
        cs.id AS clinic_id,
        COALESCE(pat.cnt, 0) AS patients_count,
        (cs.ycloud_phone_number IS NOT NULL
            OR (cs.whatsapp_provider = 'meta' AND cs.meta_phone_number_id IS NOT NULL)) AS has_whatsapp,
        COALESCE(cs.public_booking_enabled, false) AS has_booking_page,
        COALESCE(inc.cnt, 0) AS incomes_count,
        COALESCE(inc.total, 0) AS incomes_total,
        COALESCE(appt.cnt, 0) AS appointments_count,
        COALESCE(em.sent_count, 0) AS emails_sent_count,
        COALESCE(em.opened_count, 0) AS emails_opened_count,
        em.last_key,
        em.last_sent_at
    FROM public.clinic_settings cs
    LEFT JOIN LATERAL (
        SELECT count(*) AS cnt FROM public.patients p WHERE p.clinic_id = cs.id
    ) pat ON true
    LEFT JOIN LATERAL (
        SELECT count(*) AS cnt, coalesce(sum(i.amount), 0) AS total
        FROM public.incomes i WHERE i.clinic_id = cs.id
    ) inc ON true
    LEFT JOIN LATERAL (
        SELECT count(*) AS cnt FROM public.appointments a WHERE a.clinic_id = cs.id
    ) appt ON true
    LEFT JOIN LATERAL (
        SELECT
            count(*) AS sent_count,
            count(*) FILTER (WHERE e.opened_at IS NOT NULL) AS opened_count,
            (array_agg(e.email_key ORDER BY e.sent_at DESC))[1] AS last_key,
            max(e.sent_at) AS last_sent_at
        FROM public.email_sequence_log e WHERE e.clinic_id = cs.id
    ) em ON true;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_hq_clinic_activity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_hq_clinic_activity() TO authenticated, service_role;

-- ── RLS: el webhook de Resend actualiza email_sequence_log con service_role,
-- así que no hace falta política nueva para authenticated ahí — pero si en el
-- futuro se quiere leer directo desde el cliente (sin pasar por el RPC de
-- arriba), agregar entonces la policy scoped a is_platform_admin(), como ya
-- existe para `attribution`.
