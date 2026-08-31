-- ════════════════════════════════════════════════════════════════════════════
-- HQ "Clínicas" — "última actividad" también cuenta EDICIONES, no solo altas
-- ════════════════════════════════════════════════════════════════════════════
--
-- Pedido del usuario tras el fix anterior (sesión previa, misma sesión):
-- "extenderlo para que use GREATEST(created_at, updated_at) en esas mismas
-- 5 tablas, además si editan la configuracion".
--
-- Verificado ANTES de escribir esto (no asumido): de las 5 tablas del fix
-- anterior, solo `patients`, `incomes` e `inventory_products` tienen columna
-- `updated_at` real. `appointments` y `clinic_services` NO la tienen — mismo
-- hueco ya documentado en sesiones 44/69 (appointments.updated_at no existe).
-- Agregar GREATEST(created_at, updated_at) a esas dos habría roto el RPC con
-- "column does not exist".
--
-- `clinic_settings.updated_at` NO se agrega como señal — se verificó primero
-- (mismo criterio que el resto de esta sesión) y resultó sospechoso: varias
-- clínicas recién creadas muestran un `updated_at` 10-45 min después de
-- `created_at` sin que quede claro si fue una edición real en Settings o un
-- proceso de backend (ej. signup-handler haciendo un segundo UPDATE post-alta)
-- tocando la misma fila. Sumarla a ciegas podría reintroducir el mismo tipo de
-- bug que este fix corrige: una señal que aparenta actividad real del usuario
-- pero es ruido automatizado. Queda pendiente hasta poder aislar qué escritura
-- exacta mueve esa columna.
DROP FUNCTION IF EXISTS public.get_hq_clinic_activity();

CREATE FUNCTION public.get_hq_clinic_activity()
RETURNS TABLE (
    clinic_id UUID,
    patients_count BIGINT,
    has_whatsapp BOOLEAN,
    has_booking_page BOOLEAN,
    incomes_count BIGINT,
    incomes_total NUMERIC,
    appointments_count BIGINT,
    services_count BIGINT,
    products_count BIGINT,
    emails_sent_count BIGINT,
    emails_opened_count BIGINT,
    last_email_key TEXT,
    last_email_sent_at TIMESTAMPTZ,
    last_sign_in_at TIMESTAMPTZ
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
        COALESCE(svc.cnt, 0) AS services_count,
        COALESCE(prod.cnt, 0) AS products_count,
        COALESCE(em.sent_count, 0) AS emails_sent_count,
        COALESCE(em.opened_count, 0) AS emails_opened_count,
        em.last_key,
        em.last_sent_at,
        GREATEST(
            conn.last_sign_in_at,
            pat.last_activity, inc.last_activity, appt.last_created,
            svc.last_created, prod.last_activity
        ) AS last_sign_in_at
    FROM public.clinic_settings cs
    LEFT JOIN LATERAL (
        SELECT count(*) AS cnt, max(GREATEST(p.created_at, p.updated_at)) AS last_activity
        FROM public.patients p WHERE p.clinic_id = cs.id
    ) pat ON true
    LEFT JOIN LATERAL (
        SELECT count(*) AS cnt, coalesce(sum(i.amount), 0) AS total,
            max(GREATEST(i.created_at, i.updated_at)) AS last_activity
        FROM public.incomes i WHERE i.clinic_id = cs.id
    ) inc ON true
    LEFT JOIN LATERAL (
        -- appointments no tiene updated_at (verificado) — solo created_at.
        SELECT count(*) AS cnt, max(a.created_at) AS last_created FROM public.appointments a WHERE a.clinic_id = cs.id
    ) appt ON true
    LEFT JOIN LATERAL (
        -- clinic_services tampoco tiene updated_at (verificado).
        SELECT count(*) AS cnt, max(sv.created_at) AS last_created FROM public.clinic_services sv WHERE sv.clinic_id = cs.id
    ) svc ON true
    LEFT JOIN LATERAL (
        SELECT count(*) AS cnt, max(GREATEST(ip.created_at, ip.updated_at)) AS last_activity
        FROM public.inventory_products ip WHERE ip.clinic_id = cs.id
    ) prod ON true
    LEFT JOIN LATERAL (
        SELECT count(*) AS sent_count,
            count(*) FILTER (WHERE e.opened_at IS NOT NULL) AS opened_count,
            (array_agg(e.email_key ORDER BY e.sent_at DESC))[1] AS last_key,
            max(e.sent_at) AS last_sent_at
        FROM public.email_sequence_log e WHERE e.clinic_id = cs.id
    ) em ON true
    LEFT JOIN LATERAL (
        SELECT max(u.last_sign_in_at) AS last_sign_in_at
        FROM public.clinic_members cm
        JOIN auth.users u ON u.id = cm.user_id
        WHERE cm.clinic_id = cs.id
    ) conn ON true;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_hq_clinic_activity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_hq_clinic_activity() TO authenticated, service_role;
