-- Fix get_finance_item_metrics: the "Análisis" tab in Finance.tsx was empty for every
-- clinic because (a) appointment_items is barely populated yet, with no fallback to
-- appointments.service/price, and (b) the filter status='completed' AND
-- payment_status IN ('paid','partial') almost never matches how visits actually get
-- closed. A prior fix for this was applied ad-hoc via execute_sql, never saved as a
-- migration, and got silently reverted when 20260529000001_inventory_system.sql
-- re-declared the function with the old body. This time it's a real migration.

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
    items AS (
        SELECT item_type, name, quantity, subtotal FROM real_items
        UNION ALL
        SELECT item_type, name, quantity, subtotal FROM fallback_items
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
            COUNT(*)                                    AS total_appts,
            COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM public.appointment_items ai2
                WHERE ai2.appointment_id = a.id AND ai2.item_type = 'product'
            ))                                           AS appts_with_products,
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
