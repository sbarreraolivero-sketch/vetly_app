-- Análisis de Finanzas: get_finance_item_metrics / get_finance_discount_metrics recortaban el período con
-- p_end::date (fecha UTC). El navegador envía el fin de día local (p.ej. 30-sep 23:59 -03:00 = 1-oct 02:59Z),
-- así que incluían el día siguiente y no cuadraban con las tarjetas (get_finance_stats usa clinic_local_date).
-- Ahora usan la misma fecha local de la clínica. Además by_type suma un renglón 'sin_detalle' (ingresos sin
-- ítems) para que el desglose por tipo cuadre con el total.

CREATE OR REPLACE FUNCTION public.get_finance_discount_metrics(p_clinic_id uuid, p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_result JSON;
BEGIN
    -- auth.role() distingue anon de service_role; auth.uid() es NULL para ambos.
    IF COALESCE(auth.role(), 'service_role') <> 'service_role' AND NOT EXISTS (
        SELECT 1 FROM public.clinic_members cm
        WHERE cm.user_id = auth.uid() AND cm.clinic_id = p_clinic_id AND cm.status = 'active'
    ) THEN
        RAISE EXCEPTION 'Acceso denegado';
    END IF;

    WITH inc AS (
        SELECT i.id, i.amount, COALESCE(i.discount,0) AS discount,
               NULLIF(TRIM(COALESCE(i.discount_reason,'')),'') AS reason,
               i.services
        FROM public.incomes i
        WHERE i.clinic_id = p_clinic_id
          AND i.date >= public.clinic_local_date(p_clinic_id, p_start)
          AND i.date <= public.clinic_local_date(p_clinic_id, p_end)
    ),
    totals AS (
        SELECT
            COALESCE(SUM(discount),0)                              AS total_discount,
            COALESCE(SUM(amount),0)                                AS net_revenue,
            COALESCE(SUM(amount),0) + COALESCE(SUM(discount),0)    AS gross_revenue,
            COUNT(*)                                               AS total_sales,
            COUNT(*) FILTER (WHERE discount > 0)                   AS sales_with_discount,
            COALESCE(ROUND(AVG(discount) FILTER (WHERE discount > 0)),0) AS avg_discount,
            COALESCE(MAX(discount),0)                              AS max_discount
        FROM inc
    ),
    by_reason AS (
        SELECT COALESCE(reason,'__SIN_MOTIVO__') AS reason,
               COUNT(*) AS times,
               SUM(discount) AS amount
        FROM inc WHERE discount > 0
        GROUP BY 1 ORDER BY SUM(discount) DESC LIMIT 10
    ),
    -- Descuento imputado a cada ítem, con el mismo prorrateo que usa
    -- get_finance_item_metrics, para que ambos reportes sean coherentes.
    item_disc AS (
        SELECT e->>'name' AS name,
               SUM(
                   COALESCE((e->>'price')::numeric,0)
                   * (i.discount / NULLIF(g.items_gross,0))
               ) AS discount_amount,
               COUNT(*) AS times
        FROM inc i
        JOIN LATERAL (
            SELECT COALESCE(SUM(COALESCE((x->>'price')::numeric,0)),0) AS items_gross
            FROM jsonb_array_elements(COALESCE(i.services,'[]'::jsonb)) x
        ) g ON TRUE
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(i.services,'[]'::jsonb)) e
        WHERE i.discount > 0 AND g.items_gross > 0 AND NULLIF(TRIM(e->>'name'),'') IS NOT NULL
        GROUP BY 1 ORDER BY 2 DESC LIMIT 10
    )
    SELECT json_build_object(
        'total_discount',      (SELECT total_discount FROM totals),
        'gross_revenue',       (SELECT gross_revenue FROM totals),
        'net_revenue',         (SELECT net_revenue FROM totals),
        'discount_pct',        (SELECT CASE WHEN gross_revenue > 0
                                            THEN ROUND(100.0 * total_discount / gross_revenue, 1)
                                            ELSE 0 END FROM totals),
        'total_sales',         (SELECT total_sales FROM totals),
        'sales_with_discount', (SELECT sales_with_discount FROM totals),
        'avg_discount',        (SELECT avg_discount FROM totals),
        'max_discount',        (SELECT max_discount FROM totals),
        'by_reason',           (SELECT json_agg(row_to_json(t)) FROM by_reason t),
        'top_items',           (SELECT json_agg(row_to_json(t)) FROM item_disc t)
    ) INTO v_result;

    RETURN v_result;
END;
$function$;

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
          AND i.date >= public.clinic_local_date(p_clinic_id, p_start)
          AND i.date <= public.clinic_local_date(p_clinic_id, p_end)
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
        UNION ALL
        SELECT 'sin_detalle', COUNT(*), COALESCE(SUM(inc.amount),0), COUNT(*)
        FROM inc JOIN inc_totals t ON t.id = inc.id
        WHERE t.items_gross = 0 AND inc.amount > 0
        HAVING COUNT(*) > 0
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
