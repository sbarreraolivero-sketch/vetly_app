-- Auditoría de seguridad y rendimiento — 2026-10-08 (sesión 113)
-- 1) Cierra funciones SECURITY DEFINER que filtraban datos entre clínicas.
-- 2) Quita a usuarios logueados la ejecución de funciones de cron.
-- 3) Elimina funciones de depuración (debug_inspect_clinic exponía tokens de Meta).
-- 4) Reemplaza la validación de zona horaria contra pg_timezone_names (~900 ms por
--    llamada) por un helper barato. Afectaba a Finanzas y al cron de cajas.
-- 5) Reescribe la RLS de messages para que auth.uid() se evalúe una vez por consulta.

-- ── Helper de zona horaria (reemplaza el join a pg_timezone_names) ──
CREATE OR REPLACE FUNCTION public.safe_timezone(p_tz text)
RETURNS text LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
BEGIN
    IF p_tz IS NULL OR btrim(p_tz) = '' THEN RETURN 'America/Santiago'; END IF;
    PERFORM now() AT TIME ZONE p_tz;   -- lanza 22023 si no existe
    RETURN p_tz;
EXCEPTION WHEN others THEN
    RETURN 'America/Santiago';
END;
$$;

CREATE OR REPLACE FUNCTION public.clinic_local_date(p_clinic_id uuid, p_ts timestamptz)
RETURNS date LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT (p_ts AT TIME ZONE public.safe_timezone(
      (SELECT cs.timezone FROM public.clinic_settings cs WHERE cs.id = p_clinic_id)))::date
$$;

CREATE OR REPLACE FUNCTION public.auto_open_daily_cajas()
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
    INSERT INTO public.cash_registers (clinic_id, date, status)
    SELECT cs.id, (NOW() AT TIME ZONE tz.name)::DATE, 'open'
    FROM public.clinic_settings cs
    -- Timezone inválido/NULL cae a 'America/Santiago' (no aborta el INSERT completo).
    CROSS JOIN LATERAL (SELECT public.safe_timezone(cs.timezone) AS name) tz
    WHERE cs.id != '00000000-0000-0000-0000-000000000000'
      AND EXTRACT(HOUR FROM (NOW() AT TIME ZONE tz.name)) >= 7
    ON CONFLICT (clinic_id, date) DO NOTHING;
END;
$function$;

-- ── Funciones de depuración sin uso (debug_inspect_clinic devolvía clinic_settings completo) ──
DROP FUNCTION IF EXISTS public.debug_inspect_clinic(uuid);
DROP FUNCTION IF EXISTS public.audit_availability(uuid, uuid, date, text);

-- ── Crons: solo service_role / postgres ──
REVOKE EXECUTE ON FUNCTION public.reset_monthly_ai_usage()   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.process_monthly_recharge() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_open_daily_cajas()    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_close_crm_prospects() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reset_monthly_ai_usage()   TO service_role;
GRANT  EXECUTE ON FUNCTION public.process_monthly_recharge() TO service_role;
GRANT  EXECUTE ON FUNCTION public.auto_open_daily_cajas()    TO service_role;
GRANT  EXECUTE ON FUNCTION public.auto_close_crm_prospects() TO service_role;

-- ── get_finance_item_metrics: check de membresía ──
CREATE OR REPLACE FUNCTION public.get_finance_item_metrics(p_clinic_id uuid, p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_result JSON;
BEGIN
    -- Auditoría 2026-10-08: aislamiento por clínica (antes cualquier usuario logueado
    -- podía consultar datos de otra clínica pasando su UUID).
    IF COALESCE(auth.role(), 'service_role') <> 'service_role'
       AND NOT public.is_clinic_member(p_clinic_id) THEN
        RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
    END IF;
    WITH inc AS (
        SELECT i.id, i.amount, COALESCE(i.discount, 0) AS discount, i.services
        FROM public.incomes i
        WHERE i.clinic_id = p_clinic_id
          AND i.date >= p_start::date
          AND i.date <= p_end::date
    ),
    inc_totals AS (
        SELECT inc.id,
               inc.discount,
               COALESCE(SUM(COALESCE((elem->>'price')::numeric, 0)), 0) AS items_gross
        FROM inc
        LEFT JOIN LATERAL jsonb_array_elements(COALESCE(inc.services, '[]'::jsonb)) elem ON TRUE
        GROUP BY inc.id, inc.discount
    ),
    items AS (
        SELECT
            CASE WHEN elem->>'type' IN ('service','product') THEN elem->>'type' ELSE 'custom' END AS item_type,
            NULLIF(TRIM(elem->>'name'), '') AS name,
            -- Unidades reales de la línea. Fallback a 1 para los ingresos guardados
            -- antes de que existiera el campo.
            GREATEST(1, COALESCE((elem->>'quantity')::numeric, 1)) AS quantity,
            GREATEST(
                0,
                COALESCE((elem->>'price')::numeric, 0)
                * CASE WHEN t.items_gross > 0
                       THEN GREATEST(0, 1 - (t.discount / t.items_gross))
                       ELSE 1 END
            ) AS subtotal
        FROM inc
        JOIN inc_totals t ON t.id = inc.id
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(inc.services, '[]'::jsonb)) elem
    ),
    by_type AS (
        SELECT item_type,
               COUNT(*)       AS item_count,
               SUM(subtotal)  AS total_revenue,
               SUM(quantity)  AS total_units
        FROM items GROUP BY item_type
    ),
    top_services AS (
        SELECT name, SUM(subtotal) AS revenue, SUM(quantity) AS units
        FROM items WHERE item_type = 'service' AND name IS NOT NULL
        GROUP BY name ORDER BY revenue DESC LIMIT 10
    ),
    top_products AS (
        SELECT name, SUM(subtotal) AS revenue, SUM(quantity) AS units
        FROM items WHERE item_type = 'product' AND name IS NOT NULL
        GROUP BY name ORDER BY revenue DESC LIMIT 10
    ),
    top_custom AS (
        SELECT name, SUM(subtotal) AS revenue, SUM(quantity) AS units
        FROM items WHERE item_type = 'custom' AND name IS NOT NULL
        GROUP BY name ORDER BY revenue DESC LIMIT 10
    ),
    sale_metrics AS (
        SELECT
            COUNT(*)                                     AS total_sales,
            COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM jsonb_array_elements(COALESCE(inc.services, '[]'::jsonb)) e
                WHERE e->>'type' = 'product'
            ))                                           AS sales_with_products,
            COALESCE(ROUND(AVG(inc.amount)), 0)          AS avg_ticket,
            COALESCE(SUM(inc.amount), 0)                 AS total_revenue
        FROM inc
    )
    SELECT json_build_object(
        'by_type',      (SELECT json_agg(row_to_json(t)) FROM by_type t),
        'top_services', (SELECT json_agg(row_to_json(t)) FROM top_services t),
        'top_products', (SELECT json_agg(row_to_json(t)) FROM top_products t),
        'top_custom',   (SELECT json_agg(row_to_json(t)) FROM top_custom t),
        'sale_metrics', (SELECT row_to_json(t) FROM sale_metrics t),
        -- Alias de compatibilidad: el frontend anterior lee appt_metrics.
        'appt_metrics', (SELECT json_build_object(
                             'total_appts',         total_sales,
                             'appts_with_products', sales_with_products,
                             'avg_ticket',          avg_ticket
                         ) FROM sale_metrics)
    ) INTO v_result;

    RETURN v_result;
END;
$function$;

-- ── get_clinic_services_secure: check de membresía ──
CREATE OR REPLACE FUNCTION public.get_clinic_services_secure(p_clinic_id uuid)
 RETURNS TABLE(id uuid, name text, duration integer, price numeric, upselling_enabled boolean, upselling_days_after integer, upselling_message text, ai_description text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    -- Auditoría 2026-10-08: aislamiento por clínica (antes cualquier usuario logueado
    -- podía consultar datos de otra clínica pasando su UUID).
    IF COALESCE(auth.role(), 'service_role') <> 'service_role'
       AND NOT public.is_clinic_member(p_clinic_id) THEN
        RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT 
        s.id, s.name, s.duration, s.price, 
        s.upselling_enabled, s.upselling_days_after, s.upselling_message,
        s.ai_description  -- NEW FIELD
    FROM public.clinic_services s
    WHERE s.clinic_id = p_clinic_id;
END;
$function$;

-- ── get_tag_counts: check de membresía ──
CREATE OR REPLACE FUNCTION public.get_tag_counts(p_clinic_id uuid)
 RETURNS TABLE(tag_id uuid, tag_name text, tag_color text, contact_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    -- Auditoría 2026-10-08: aislamiento por clínica (antes cualquier usuario logueado
    -- podía consultar datos de otra clínica pasando su UUID).
    IF COALESCE(auth.role(), 'service_role') <> 'service_role'
       AND NOT public.is_clinic_member(p_clinic_id) THEN
        RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    WITH all_tags AS (
        SELECT t.id AS _tag_id, t.name AS _name, t.color AS _color, pt.tutor_id AS contact_id
        FROM public.tags t
        JOIN public.tutor_tags pt ON t.id = pt.tag_id
        WHERE t.clinic_id = p_clinic_id

        UNION ALL

        SELECT ct.id AS _tag_id, ct.name AS _name, ct.color AS _color, cpt.prospect_id AS contact_id
        FROM public.crm_tags ct
        JOIN public.crm_prospect_tags cpt ON ct.id = cpt.tag_id
        WHERE ct.clinic_id = p_clinic_id
    )
    SELECT
        _tag_id                            AS tag_id,
        _name                              AS tag_name,
        MAX(_color)                        AS tag_color,
        COUNT(DISTINCT contact_id)::BIGINT AS contact_count
    FROM all_tags
    GROUP BY _tag_id, _name
    ORDER BY COUNT(DISTINCT contact_id) DESC;
END;
$function$;

-- ── get_estimated_audience: check de membresía ──
CREATE OR REPLACE FUNCTION public.get_estimated_audience(p_clinic_id uuid, p_inclusion_tags uuid[], p_exclusion_tags uuid[])
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_count BIGINT;
BEGIN
    -- Auditoría 2026-10-08: aislamiento por clínica (antes cualquier usuario logueado
    -- podía consultar datos de otra clínica pasando su UUID).
    IF COALESCE(auth.role(), 'service_role') <> 'service_role'
       AND NOT public.is_clinic_member(p_clinic_id) THEN
        RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
    END IF;
    SELECT COUNT(DISTINCT t.id) INTO v_count
    FROM tutors t
    WHERE t.clinic_id = p_clinic_id
      AND t.phone_number IS NOT NULL
      AND (
          p_inclusion_tags IS NULL
          OR ARRAY_LENGTH(p_inclusion_tags, 1) IS NULL
          OR EXISTS (
              SELECT 1 FROM tutor_tags tt
              WHERE tt.tutor_id = t.id
                AND tt.tag_id = ANY(p_inclusion_tags)
          )
      )
      AND (
          p_exclusion_tags IS NULL
          OR ARRAY_LENGTH(p_exclusion_tags, 1) IS NULL
          OR NOT EXISTS (
              SELECT 1 FROM tutor_tags tt
              WHERE tt.tutor_id = t.id
                AND tt.tag_id = ANY(p_exclusion_tags)
          )
      );

    RETURN COALESCE(v_count, 0);
END;
$function$;

-- ── get_clinic_professionals: check de membresía ──
CREATE OR REPLACE FUNCTION public.get_clinic_professionals(p_clinic_id uuid)
 RETURNS TABLE(member_id uuid, first_name text, last_name text, email text, role text, job_title text, specialty text, color text, working_hours jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    -- Auditoría 2026-10-08: aislamiento por clínica (antes cualquier usuario logueado
    -- podía consultar datos de otra clínica pasando su UUID).
    IF COALESCE(auth.role(), 'service_role') <> 'service_role'
       AND NOT public.is_clinic_member(p_clinic_id) THEN
        RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT 
        cm.id as member_id,
        cm.first_name,
        cm.last_name,
        cm.email,
        cm.role::TEXT,      -- Cast to TEXT to match return type
        cm.job_title,
        cm.specialty,
        cm.color,
        cm.working_hours
    FROM public.clinic_members cm
    WHERE cm.clinic_id = p_clinic_id
      AND cm.status = 'active'
      AND cm.role::TEXT NOT IN ('receptionist')
    ORDER BY cm.first_name ASC;
END;
$function$;

-- ── get_available_slots: check de membresía ──
CREATE OR REPLACE FUNCTION public.get_available_slots(p_clinic_id uuid, p_date date, p_duration integer DEFAULT 60, p_timezone text DEFAULT 'America/Santiago'::text, p_interval integer DEFAULT 30, p_last_slot_cap time without time zone DEFAULT NULL::time without time zone)
 RETURNS TABLE(slot_time time without time zone, is_available boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_working_hours JSONB;
  v_dow INTEGER;
  v_day_name TEXT;
  v_day_hours JSONB;
  v_open_time TIME;
  v_close_time TIME;
  v_current_time TIME;
BEGIN
    -- Auditoría 2026-10-08: aislamiento por clínica (antes cualquier usuario logueado
    -- podía consultar datos de otra clínica pasando su UUID).
    IF COALESCE(auth.role(), 'service_role') <> 'service_role'
       AND NOT public.is_clinic_member(p_clinic_id) THEN
        RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
    END IF;
  IF EXISTS (SELECT 1 FROM public.clinic_blocked_dates WHERE clinic_id = p_clinic_id AND blocked_date = p_date) THEN
    RETURN;
  END IF;

  SELECT working_hours INTO v_working_hours
  FROM public.clinic_settings
  WHERE id = p_clinic_id;

  IF v_working_hours IS NULL THEN
    RETURN;
  END IF;

  v_dow := EXTRACT(DOW FROM p_date);
  v_day_name := CASE v_dow
    WHEN 1 THEN 'monday'
    WHEN 2 THEN 'tuesday'
    WHEN 3 THEN 'wednesday'
    WHEN 4 THEN 'thursday'
    WHEN 5 THEN 'friday'
    WHEN 6 THEN 'saturday'
    WHEN 0 THEN 'sunday'
  END;

  v_day_hours := v_working_hours->v_day_name;

  IF v_day_hours IS NULL OR v_day_hours = 'null'::jsonb OR (v_day_hours->>'enabled')::BOOLEAN IS FALSE THEN
    RETURN;
  END IF;

  v_open_time  := (COALESCE(v_day_hours->>'open',  v_day_hours->>'start', '09:00'))::TIME;
  v_close_time := (COALESCE(v_day_hours->>'close', v_day_hours->>'end',   '20:00'))::TIME;

  IF p_date = CURRENT_DATE THEN
    v_current_time := (CURRENT_TIMESTAMP AT TIME ZONE p_timezone)::TIME;
    IF v_current_time < v_open_time THEN
        v_current_time := v_open_time;
    END IF;
  ELSE
    v_current_time := v_open_time;
  END IF;

  LOOP
    IF p_last_slot_cap IS NOT NULL THEN
      EXIT WHEN v_current_time > p_last_slot_cap;
    ELSE
      EXIT WHEN v_current_time + (p_duration || ' minutes')::INTERVAL > v_close_time;
    END IF;

    slot_time := v_current_time;
    is_available := public.check_availability(p_clinic_id, p_date, v_current_time, p_duration, p_last_slot_cap);

    IF is_available THEN
        RETURN NEXT;
    END IF;

    v_current_time := v_current_time + (p_interval || ' minutes')::INTERVAL;
  END LOOP;
END;
$function$;

-- ── check_availability: check de membresía ──
CREATE OR REPLACE FUNCTION public.check_availability(p_clinic_id uuid, p_date date, p_time time without time zone, p_duration integer DEFAULT 60, p_last_slot_cap time without time zone DEFAULT NULL::time without time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_timezone TEXT;
  v_any_prof_free BOOLEAN := FALSE;
  v_member_id UUID;
BEGIN
    -- Auditoría 2026-10-08: aislamiento por clínica (antes cualquier usuario logueado
    -- podía consultar datos de otra clínica pasando su UUID).
    IF COALESCE(auth.role(), 'service_role') <> 'service_role'
       AND NOT public.is_clinic_member(p_clinic_id) THEN
        RAISE EXCEPTION 'Acceso denegado' USING ERRCODE = '42501';
    END IF;
  IF EXISTS (SELECT 1 FROM public.clinic_blocked_dates WHERE clinic_id = p_clinic_id AND blocked_date = p_date) THEN
    RETURN FALSE;
  END IF;

  SELECT timezone INTO v_timezone FROM public.clinic_settings WHERE id = p_clinic_id;
  IF v_timezone IS NULL THEN v_timezone := 'America/Santiago'; END IF;

  FOR v_member_id IN (
    SELECT id FROM public.clinic_members
    WHERE clinic_id = p_clinic_id
      AND status = 'active'
      AND role NOT IN ('receptionist', 'admin')
  ) LOOP
    IF EXISTS (
        SELECT 1 FROM public.get_professional_available_slots(
          p_clinic_id,
          v_member_id,
          p_date,
          p_duration,
          30,
          v_timezone,
          p_last_slot_cap
        )
        WHERE to_char(slot_time, 'HH24:MI') = to_char(p_time, 'HH24:MI') AND is_available = TRUE
    ) THEN
        v_any_prof_free := TRUE;
        EXIT;
    END IF;
  END LOOP;

  RETURN v_any_prof_free;
END;
$function$;

-- ── update_caja_opening_balance: p_user_id era falsificable ──
CREATE OR REPLACE FUNCTION public.update_caja_opening_balance(p_clinic_id uuid, p_date date, p_amount numeric, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.clinic_members
        WHERE clinic_id = p_clinic_id AND user_id = auth.uid() AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'Acceso denegado';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.cash_registers
        WHERE clinic_id = p_clinic_id AND date = p_date AND status = 'closed'
    ) THEN
        RAISE EXCEPTION 'No se puede modificar el saldo de una caja cerrada';
    END IF;
    INSERT INTO public.cash_registers (clinic_id, date, status, opening_balance)
    VALUES (p_clinic_id, p_date, 'open', p_amount)
    ON CONFLICT (clinic_id, date) DO UPDATE SET opening_balance = EXCLUDED.opening_balance;
END;
$function$;

-- ── get_credit_history_summary: filtra a las clínicas del usuario ──
CREATE OR REPLACE FUNCTION public.get_credit_history_summary(p_clinic_ids uuid[], p_month_start timestamptz, p_month_end timestamptz)
 RETURNS TABLE(consumed bigint, messages bigint, recharged bigint, total bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
    SELECT
        COALESCE(SUM(CASE WHEN type = 'consumption' THEN ABS(amount) ELSE 0 END), 0),
        COALESCE(COUNT(CASE WHEN type = 'consumption' THEN 1 END), 0),
        COALESCE(SUM(CASE WHEN type IN ('monthly_refill','purchase') THEN amount ELSE 0 END), 0),
        COUNT(*)
    FROM public.ai_credit_transactions
    WHERE clinic_id = ANY(p_clinic_ids)
      AND (COALESCE(auth.role(), 'service_role') = 'service_role' OR public.is_clinic_member(clinic_id))
      AND created_at >= p_month_start
      AND created_at <= p_month_end;
$function$;

-- ── find_tutor_by_phone_public: solo para clínicas con reservas online activas ──
CREATE OR REPLACE FUNCTION public.find_tutor_by_phone_public(p_clinic_id uuid, p_phone text)
 RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
    SELECT id FROM public.tutors
    WHERE clinic_id = p_clinic_id AND phone_number = p_phone
      AND public.clinic_has_public_booking(p_clinic_id)
    LIMIT 1;
$function$;

-- ── RLS de messages: auth.uid() evaluado una vez por consulta (initplan) ──
DROP POLICY IF EXISTS "Clinic members can see their messages" ON public.messages;
CREATE POLICY "Clinic members can see their messages" ON public.messages
    FOR ALL USING (clinic_id IN (
        SELECT cm.clinic_id FROM public.clinic_members cm
        WHERE cm.user_id = (SELECT auth.uid()) AND cm.status = 'active'));
DROP POLICY IF EXISTS "Platform admins can access all messages" ON public.messages;
CREATE POLICY "Platform admins can access all messages" ON public.messages
    FOR ALL USING ((SELECT public.is_platform_admin()));
DROP POLICY IF EXISTS "Service Role Full Access" ON public.messages;
CREATE POLICY "Service Role Full Access" ON public.messages
    FOR ALL USING ((SELECT auth.role()) = 'service_role');

-- ── Re-asegurar privilegios de lo reemplazado ──
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.proname IN ('get_finance_item_metrics','get_clinic_services_secure','get_tag_counts',
             'get_estimated_audience','get_clinic_professionals','get_available_slots','check_availability',
             'update_caja_opening_balance','get_credit_history_summary','safe_timezone','clinic_local_date')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END $$;
