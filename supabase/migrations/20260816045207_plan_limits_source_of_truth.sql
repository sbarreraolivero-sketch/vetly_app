-- ============================================================================
-- plan_limits: fuente única de verdad de los límites por plan (lado backend)
-- ============================================================================
-- Antes de esta migración el mapeo plan→límites estaba duplicado en 8 lugares
-- (4 en frontend, 4 en edge functions) con valores divergentes y distinto grado
-- de soporte de los IDs nuevos (core/starter/pro/enterprise vs. los legacy
-- essence/radiance/prestige). Cambiar un límite obligaba a tocarlos todos.
--
-- A partir de aquí:
--   · Esta tabla es la autoridad para invite_member_v2 y las edge functions.
--   · src/lib/plans.ts la espeja en el frontend (display + gating de páginas).
-- Si cambias un número aquí, cámbialo también en src/lib/plans.ts.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.plan_limits (
    plan_id              TEXT PRIMARY KEY,
    rank                 INTEGER NOT NULL,           -- orden de la escalera (para comparaciones >=)
    max_users            INTEGER NOT NULL,
    max_agendas          INTEGER NOT NULL,
    monthly_reminders    INTEGER,                    -- NULL = ilimitado
    ai_credits           INTEGER NOT NULL DEFAULT 0,
    allows_2h_reminder   BOOLEAN NOT NULL DEFAULT true,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.plan_limits IS
    'Fuente única de verdad de límites por plan. Espejada en src/lib/plans.ts para el frontend.';
COMMENT ON COLUMN public.plan_limits.monthly_reminders IS
    'NULL = ilimitado. Pool compartido entre recordatorios de citas y médicos.';
COMMENT ON COLUMN public.plan_limits.allows_2h_reminder IS
    'Core solo tiene el recordatorio de 24h (el que evita el no-show). El de 2h desde Starter.';

INSERT INTO public.plan_limits
    (plan_id, rank, max_users, max_agendas, monthly_reminders, ai_credits, allows_2h_reminder)
VALUES
    -- Planes vigentes
    ('core',       0, 3,      1,      25,   0,     false),
    ('starter',    1, 5,      3,      100,  5000,  true),
    ('pro',        2, 10,     5,      250,  10000, true),
    ('enterprise', 3, 999999, 999999, NULL, 30000, true),
    -- IDs legacy: mismos valores que su equivalente vigente (essence→starter, etc.)
    ('essence',    1, 5,      3,      100,  5000,  true),
    ('radiance',   2, 10,     5,      250,  10000, true),
    ('prestige',   3, 999999, 999999, NULL, 30000, true)
ON CONFLICT (plan_id) DO UPDATE SET
    rank               = EXCLUDED.rank,
    max_users          = EXCLUDED.max_users,
    max_agendas        = EXCLUDED.max_agendas,
    monthly_reminders  = EXCLUDED.monthly_reminders,
    ai_credits         = EXCLUDED.ai_credits,
    allows_2h_reminder = EXCLUDED.allows_2h_reminder,
    updated_at         = now();

-- RLS: lectura para cualquier usuario autenticado (el frontend puede consultarla),
-- escritura solo service_role.
ALTER TABLE public.plan_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plan_limits_read ON public.plan_limits;
CREATE POLICY plan_limits_read ON public.plan_limits
    FOR SELECT TO authenticated, anon USING (true);

DROP POLICY IF EXISTS plan_limits_service_role ON public.plan_limits;
CREATE POLICY plan_limits_service_role ON public.plan_limits
    FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ============================================================================
-- invite_member_v2: resolver max_users desde plan_limits en vez del CASE inline
-- ============================================================================
-- Cambios respecto de la versión anterior:
--   1. El CASE hardcodeado se reemplaza por un lookup a plan_limits.
--   2. Se resuelve el plan como COALESCE(plan_id, plan) — en producción ambas
--      columnas discrepan (plan='essence' vs plan_id='prestige') y plan_id es
--      la que escribe mercadopago-webhook y la que lee Settings.tsx.
--   3. Se mantiene intacta la precedencia de manually_active (clinic_settings.max_users
--      manda para las cuentas que pagan por transferencia, como Animalgrace).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.invite_member_v2(
    p_clinic_id uuid,
    p_email text,
    p_role user_role,
    p_first_name text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_pool_id       UUID;
    v_current_count INTEGER;
    v_max_users     INTEGER;
    v_plan          TEXT;
    v_sub_plan      TEXT;
    v_manually      BOOLEAN;
    v_limit_users   INTEGER;
    v_new_id        UUID;
BEGIN
    -- Solo owner/admin de esta clínica
    IF NOT public.is_clinic_admin(p_clinic_id) THEN
        RAISE EXCEPTION 'Access denied. Only owners/admins can invite members.';
    END IF;

    -- Raíz del pool (si es sucursal, usa la clínica madre)
    SELECT COALESCE(parent_clinic_id, id)
      INTO v_pool_id
      FROM public.clinic_settings
     WHERE id = p_clinic_id;

    -- Baseline desde clinic_settings de la raíz
    SELECT max_users, subscription_plan
      INTO v_max_users, v_plan
      FROM public.clinic_settings
     WHERE id = v_pool_id;

    SELECT manually_active
      INTO v_manually
      FROM public.subscriptions
     WHERE clinic_id = v_pool_id
     LIMIT 1;

    -- Si NO es cuenta activada manualmente, el plan de subscriptions manda
    IF NOT COALESCE(v_manually, false) THEN
        SELECT COALESCE(NULLIF(plan_id, ''), plan)
          INTO v_sub_plan
          FROM public.subscriptions
         WHERE clinic_id = v_pool_id
           AND status IN ('active', 'trial', 'trialing', 'converted', 'freemium')
         LIMIT 1;

        IF v_sub_plan IS NOT NULL THEN
            v_plan := v_sub_plan;

            SELECT max_users INTO v_limit_users
              FROM public.plan_limits
             WHERE plan_id = v_sub_plan;

            -- Plan desconocido → conserva el baseline de clinic_settings
            v_max_users := COALESCE(v_limit_users, v_max_users, 2);
        END IF;
    END IF;
    -- manually_active = true → clinic_settings.max_users es la verdad

    v_max_users := COALESCE(v_max_users, 2);

    IF EXISTS (
        SELECT 1 FROM public.clinic_members
         WHERE clinic_id = p_clinic_id
           AND email     = p_email
           AND status    IN ('active', 'invited')
    ) THEN
        RAISE EXCEPTION 'Este correo ya tiene una invitación pendiente o pertenece a un miembro activo.';
    END IF;

    -- >= 999 se trata como ilimitado (sentinel histórico)
    IF v_max_users < 999 THEN
        SELECT COUNT(*) INTO v_current_count
          FROM public.clinic_members
         WHERE clinic_id = p_clinic_id
           AND status IN ('active', 'invited');

        IF v_current_count >= v_max_users THEN
            RAISE EXCEPTION 'Plan limit reached. Maximum % users allowed for plan %.',
                v_max_users, COALESCE(v_plan, 'unknown');
        END IF;
    END IF;

    INSERT INTO public.clinic_members (clinic_id, email, role, status, first_name)
    VALUES (p_clinic_id, p_email, p_role, 'invited', p_first_name)
    RETURNING id INTO v_new_id;

    RETURN jsonb_build_object('id', v_new_id, 'status', 'success');
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.invite_member_v2(uuid, text, user_role, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.invite_member_v2(uuid, text, user_role, text) TO authenticated, service_role;
