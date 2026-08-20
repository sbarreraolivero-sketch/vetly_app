-- ============================================================================
-- `get_finance_item_metrics` contaba unidades vendidas con `1::numeric AS quantity`
-- hardcodeado: una unidad por elemento del array `incomes.services`.
--
-- Eso daba bien mientras cada unidad era una fila repetida del array (agregar la
-- misma vacuna 3 veces creaba 3 elementos). Ahora el formulario de Ingreso agrupa
-- las unidades en una sola línea con `quantity`, así que sin este cambio el tab
-- "Análisis" empezaría a subestimar las unidades apenas se use el stepper.
--
-- `total_revenue` NO cambia: sigue sumando `price`, que se guarda como el total de
-- la línea (unitario × cantidad). Lo único que cambia es el conteo de unidades.
-- Los ingresos anteriores no traen `quantity` y caen a 1 vía COALESCE, así que el
-- histórico se sigue calculando exactamente igual — sin backfill.
--
-- Verificado antes/después sobre agosto 2026 en ambas sedes: by_type idéntico.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_finance_item_metrics(
    p_clinic_id uuid, p_start timestamp with time zone, p_end timestamp with time zone
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_result JSON;
BEGIN
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

REVOKE EXECUTE ON FUNCTION public.get_finance_item_metrics(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_finance_item_metrics(uuid, timestamptz, timestamptz) TO authenticated, service_role;
