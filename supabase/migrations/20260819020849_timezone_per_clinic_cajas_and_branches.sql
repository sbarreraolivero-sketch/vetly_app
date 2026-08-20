-- ============================================================
-- Zona horaria por clínica: apertura automática de cajas
-- y creación de sucursales.
--
-- Problema: auto_open_daily_cajas() calculaba "hoy" con
-- 'America/Santiago' hardcodeado, y create_clinic_branch()
-- insertaba ese mismo literal como timezone de toda sucursal
-- nueva. Ambos bloquean la operación fuera de Chile.
--
-- Ya hay una clínica en producción con America/Mexico_City,
-- así que el bug está activo, no es teórico.
-- ============================================================

-- ------------------------------------------------------------
-- 1. auto_open_daily_cajas(): fecha y hora según la zona de
--    cada clínica, no un literal global.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_open_daily_cajas()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.cash_registers (clinic_id, date, status)
    SELECT cs.id, (NOW() AT TIME ZONE tz.name)::DATE, 'open'
    FROM public.clinic_settings cs
    -- Valida el timezone contra el catálogo de Postgres antes de usarlo.
    -- Un valor NULL o mal escrito cae a 'America/Santiago' en lugar de
    -- lanzar 22023 (time zone not recognized), que abortaría el INSERT
    -- completo y dejaría a TODAS las clínicas sin caja ese día.
    LEFT JOIN LATERAL (
        SELECT COALESCE(
            (SELECT t.name FROM pg_timezone_names t WHERE t.name = cs.timezone),
            'America/Santiago'
        ) AS name
    ) tz ON TRUE
    WHERE cs.id != '00000000-0000-0000-0000-000000000000'  -- excluir HQ
      -- Abrir recién cuando en la zona de esa clínica ya son las 07:00.
      -- Se usa >= y no = para que una ejecución perdida (o un salto de
      -- DST) se recupere en la pasada siguiente en vez de perder el día.
      AND EXTRACT(HOUR FROM (NOW() AT TIME ZONE tz.name)) >= 7
    ON CONFLICT (clinic_id, date) DO NOTHING;
END;
$$;

-- ------------------------------------------------------------
-- 2. Cron: de 1 vez al día (11:00 UTC) a cada hora.
--    Con una sola corrida diaria la hora local de apertura
--    variaba por país (07:00 Chile, 05:00 México, 13:00 España).
--    Corriendo cada hora, el filtro de las 07:00 de arriba hace
--    que cada clínica abra a las 07:00 de SU hora local.
-- ------------------------------------------------------------
DO $$
DECLARE
    v_jobid BIGINT;
BEGIN
    SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'auto-open-cajas';

    IF v_jobid IS NOT NULL THEN
        PERFORM cron.alter_job(v_jobid, schedule => '0 * * * *');
    ELSE
        PERFORM cron.schedule(
            'auto-open-cajas',
            '0 * * * *',
            'SELECT public.auto_open_daily_cajas()'
        );
    END IF;
END $$;

-- ------------------------------------------------------------
-- 3. create_clinic_branch(): la sucursal hereda la zona horaria
--    de la clínica raíz del owner en vez de nacer siempre en
--    Chile. Sin esto, un cliente Enterprise de otro país queda
--    con sucursales en zona chilena de forma silenciosa.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_clinic_branch(
    p_name TEXT,
    p_address TEXT DEFAULT NULL::TEXT
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_new_clinic_id UUID;
    v_user_email    TEXT;
    v_branch_count  INTEGER;
    v_timezone      TEXT;
BEGIN
    v_user_email := auth.jwt()->>'email';

    -- Only owners can create branches
    IF NOT EXISTS (SELECT 1 FROM public.clinic_members WHERE user_id = auth.uid() AND role = 'owner') THEN
        RAISE EXCEPTION 'Solo los dueños de clínica pueden crear sucursales adicionales.';
    END IF;

    -- Count existing clinics this user owns (including root)
    SELECT COUNT(*) INTO v_branch_count
    FROM public.clinic_members cm
    JOIN public.clinic_settings cs ON cs.id = cm.clinic_id
    WHERE cm.user_id = auth.uid()
      AND cm.role = 'owner'
      AND cm.status = 'active';

    -- Enterprise plan allows up to 3 total (root + 2 branches = 3)
    IF v_branch_count >= 3 THEN
        RAISE EXCEPTION 'Has alcanzado el límite de 3 sucursales del plan Enterprise. Contacta soporte para ampliar.';
    END IF;

    -- Heredar la zona horaria de la clínica raíz del owner (la más antigua
    -- que posee). Antes esto era 'America/Santiago' literal.
    SELECT cs.timezone INTO v_timezone
    FROM public.clinic_members cm
    JOIN public.clinic_settings cs ON cs.id = cm.clinic_id
    WHERE cm.user_id = auth.uid()
      AND cm.role = 'owner'
      AND cm.status = 'active'
    ORDER BY cs.created_at ASC
    LIMIT 1;

    -- SELECT INTO deja la variable en NULL si no encuentra filas, así que
    -- el COALESCE va aparte y no como valor por defecto de la declaración.
    v_timezone := COALESCE(v_timezone, 'America/Santiago');

    -- Create the new branch
    INSERT INTO public.clinic_settings (
        clinic_name,
        address,
        subscription_plan,
        max_users,
        timezone
    )
    VALUES (
        p_name,
        p_address,
        'enterprise',
        999999,
        v_timezone
    )
    RETURNING id INTO v_new_clinic_id;

    -- Insert owner membership
    INSERT INTO public.clinic_members (clinic_id, user_id, email, role, status)
    VALUES (v_new_clinic_id, auth.uid(), v_user_email, 'owner', 'active');

    RETURN v_new_clinic_id;
END;
$$;

-- ------------------------------------------------------------
-- 4. Restaurar privilegios.
--    CREATE OR REPLACE FUNCTION resetea el ACL al default, que
--    incluye EXECUTE para PUBLIC (y por herencia, anon). Sin
--    esto se reabriría el acceso anónimo que se cerró en la
--    auditoría de seguridad de la sesión 77.
--    Se replica el ACL exacto que tenían antes de esta migración.
-- ------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.auto_open_daily_cajas() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.auto_open_daily_cajas() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.create_clinic_branch(TEXT, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_clinic_branch(TEXT, TEXT) TO authenticated, service_role;
