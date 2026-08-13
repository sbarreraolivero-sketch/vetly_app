-- "Top Productos" y el desglose por tipo en el tab Análisis de Finanzas seguían
-- vacíos/incompletos porque get_finance_item_metrics solo leía appointment_items,
-- pero el equipo registra la mayoría de las ventas de producto vía "+ Ingreso"
-- (incomes.services, JSONB), un flujo que nunca toca appointment_items al no
-- estar ligado a una cita. Se agrega un CTE que también lee esos productos.
--
-- appts_with_products / total_appts se mantienen ligados exclusivamente a
-- appointment_items — "citas con productos" es, por definición, una métrica de
-- citas, no de ingresos manuales sin cita asociada.

CREATE OR REPLACE FUNCTION public.get_finance_item_metrics(
    p_clinic_id  UUID,
    p_start      TIMESTAMPTZ,
    p_end        TIMESTAMPTZ
)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_result JSON;
BEGIN
    WITH base_appts AS (
        SELECT a.id, a.service, a.price
        FROM public.appointments a
        WHERE a.clinic_id = p_clinic_id
          AND a.appointment_date >= p_start
          AND a.appointment_date <= p_end
          AND a.status != 'cancelled'
          AND a.price > 0
    ),
    real_items AS (
        SELECT ai.item_type, ai.name, ai.quantity, ai.subtotal
        FROM public.appointment_items ai
        JOIN base_appts a ON a.id = ai.appointment_id
    ),
    -- Synthesize a 'service' item for appointments with no appointment_items rows
    -- (the common case today, since appointment_items is barely populated yet).
    fallback_items AS (
        SELECT 'service'::text AS item_type,
               a.service AS name,
               1::numeric AS quantity,
               a.price AS subtotal
        FROM base_appts a
        WHERE a.service IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM public.appointment_items ai2
              WHERE ai2.appointment_id = a.id
          )
    ),
    -- Ventas de producto registradas vía "+ Ingreso" (incomes.services), que no
    -- pasan por appointment_items al no estar ligadas a una cita. Cada elemento
    -- con type='product' en el JSONB representa 1 unidad vendida.
    income_items AS (
        SELECT
            'product'::text AS item_type,
            elem->>'name' AS name,
            1::numeric AS quantity,
            COALESCE((elem->>'price')::numeric, 0) AS subtotal
        FROM public.incomes i,
             jsonb_array_elements(COALESCE(i.services, '[]'::jsonb)) elem
        WHERE i.clinic_id = p_clinic_id
          AND i.date >= p_start::date
          AND i.date <= p_end::date
          AND elem->>'type' = 'product'
    ),
    items AS (
        SELECT item_type, name, quantity, subtotal FROM real_items
        UNION ALL
        SELECT item_type, name, quantity, subtotal FROM fallback_items
        UNION ALL
        SELECT item_type, name, quantity, subtotal FROM income_items
    ),
    by_type AS (
        SELECT
            item_type,
            COUNT(*)          AS item_count,
            SUM(subtotal)     AS total_revenue,
            SUM(quantity)     AS total_units
        FROM items
        GROUP BY item_type
    ),
    top_services AS (
        SELECT name, SUM(subtotal) AS revenue, SUM(quantity) AS units
        FROM items WHERE item_type = 'service'
        GROUP BY name
        ORDER BY revenue DESC
        LIMIT 10
    ),
    top_products AS (
        SELECT name, SUM(subtotal) AS revenue, SUM(quantity) AS units
        FROM items WHERE item_type = 'product'
        GROUP BY name
        ORDER BY revenue DESC
        LIMIT 10
    ),
    appt_metrics AS (
        SELECT
            COUNT(DISTINCT a.id)                        AS total_appts,
            COUNT(DISTINCT CASE WHEN EXISTS (
                SELECT 1 FROM public.appointment_items ai2
                WHERE ai2.appointment_id = a.id AND ai2.item_type = 'product'
            ) THEN a.id END)                            AS appts_with_products,
            COALESCE(AVG(a.price), 0)                    AS avg_ticket
        FROM base_appts a
    )
    SELECT json_build_object(
        'by_type',        (SELECT json_agg(row_to_json(t)) FROM by_type t),
        'top_services',   (SELECT json_agg(row_to_json(t)) FROM top_services t),
        'top_products',   (SELECT json_agg(row_to_json(t)) FROM top_products t),
        'appt_metrics',   (SELECT row_to_json(t) FROM appt_metrics t)
    ) INTO v_result;

    RETURN v_result;
END;
$$;
